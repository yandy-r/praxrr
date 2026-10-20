import { assertEquals, assertExists, assertThrows } from '@std/assert';
import type { RequestEvent } from '@sveltejs/kit';
import { BaseTest, type TestContext } from './BaseTest.ts';
import { assertSafeArrUrl } from '$arr/urlSafety.ts';
import { config } from '$config';
import { db } from '$db/db.ts';
import { setupStateQueries, type WizardStep } from '$db/queries/setupState.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries, type DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { arrSyncQueries, type QualityProfilesSyncData } from '$db/queries/arrSync.ts';
import {
  assertSetupInProgress,
  getSetupProgress,
  resolveResumeStep,
  resolveSetupChecklist,
  resolveWizardRedirect,
} from '$server/setup/progress.ts';

type Restore = () => void;

function buildNavigationEvent(pathname: string, method: string): RequestEvent {
  const url = new URL(`http://localhost${pathname}`);
  return {
    request: new Request(url, { method }),
    url,
  } as unknown as RequestEvent;
}

/**
 * Setup wizard unit tests: the SSRF URL guard, the setup_state wizard queries,
 * prerequisite progress, and the navigation/API gates that drive the wizard.
 */
class SetupProgressTest extends BaseTest {
  private restores: Restore[] = [];

  protected override beforeEach(): void {
    this.restores = [];
  }

  protected override afterEach(): void {
    for (const restore of this.restores.reverse()) {
      restore();
    }
  }

  private patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    this.restores.push(() => {
      target[key] = original;
    });
  }

  /**
   * Point the db singleton at a scratch SQLite file under the test's tempDir
   * and bootstrap the setup_state table (mirrors migrations 039 + 20260707 +
   * 20261020).
   */
  private async withSetupStateDatabase(context: TestContext, fn: () => void | Promise<void>): Promise<void> {
    const originalBasePath = config.paths.base;
    db.close();
    config.setBasePath(context.tempDir);

    try {
      await db.initialize();
      db.exec(`
        CREATE TABLE setup_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          default_database_linked INTEGER NOT NULL DEFAULT 0,
          wizard_completed INTEGER NOT NULL DEFAULT 0,
          wizard_dismissed_at TEXT,
          wizard_current_step TEXT NOT NULL DEFAULT 'welcome',
          setup_checklist_dismissed_at TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO setup_state (id, default_database_linked) VALUES (1, 0);
      `);

      await fn();
    } finally {
      db.close();
      config.setBasePath(originalBasePath);
    }
  }

  runTests(): void {
    // ---- assertSafeArrUrl (pure function, no DB) ----

    this.test('assertSafeArrUrl rejects cloud metadata and link-local addresses', () => {
      assertThrows(() => assertSafeArrUrl('http://169.254.169.254'));
      assertThrows(() => assertSafeArrUrl('http://0.0.0.0'));
      assertThrows(() => assertSafeArrUrl('http://[fd00:ec2::254]'));
      assertThrows(() => assertSafeArrUrl('http://169.254.1.1'));
      assertThrows(() => assertSafeArrUrl('ftp://x'));
      assertThrows(() => assertSafeArrUrl('http://[fe80::1]'));
      assertThrows(() => assertSafeArrUrl('http://[fe90::1]'));
      assertThrows(() => assertSafeArrUrl('http://[febf:ffff::1]'));
      // IPv4-mapped/NAT64 IPv6 literals embedding a metadata address.
      assertThrows(() => assertSafeArrUrl('http://[::ffff:169.254.169.254]'));
      assertThrows(() => assertSafeArrUrl('http://[64:ff9b::169.254.169.254]'));
    });

    this.test('assertSafeArrUrl accepts LAN, loopback, localhost, and public https hosts', () => {
      assertSafeArrUrl('http://10.0.0.5:7878');
      assertSafeArrUrl('http://127.0.0.1:7878');
      assertSafeArrUrl('http://localhost:7878');
      assertSafeArrUrl('https://radarr.example.com');
      assertSafeArrUrl('http://[::1]');
      assertSafeArrUrl('http://[2606:4700:4700::1111]');
    });

    // ---- setupStateQueries wizard methods (real DB) ----

    this.test('setWizardStep advances the current step and rejects an invalid step', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        assertEquals(setupStateQueries.setWizardStep('connect-arr'), true);
        assertEquals(setupStateQueries.getWizardState().currentStep, 'connect-arr');
        assertThrows(() => setupStateQueries.setWizardStep('not-a-step' as WizardStep), Error, 'Invalid wizard step');
      });
    });

    this.test('markWizardCompleted flips wizardShouldRun to false', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        assertEquals(setupStateQueries.wizardShouldRun(), true);
        assertEquals(setupStateQueries.markWizardCompleted(), true);
        assertEquals(setupStateQueries.wizardShouldRun(), false);
        assertEquals(setupStateQueries.getWizardState().completed, true);
      });
    });

    this.test('markWizardDismissed flips wizardShouldRun to false', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        assertEquals(setupStateQueries.wizardShouldRun(), true);
        assertEquals(setupStateQueries.markWizardDismissed(), true);
        assertEquals(setupStateQueries.wizardShouldRun(), false);
        assertExists(setupStateQueries.getWizardState().dismissedAt);
      });
    });

    this.test('getWizardState returns the completed/dismissedAt/currentStep shape', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        assertEquals(setupStateQueries.getWizardState(), {
          completed: false,
          dismissedAt: null,
          currentStep: 'welcome',
        });
      });
    });

    this.test('reopenWizard clears completion, dismissal, and checklist dismissal idempotently', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        setupStateQueries.markWizardDismissed();
        setupStateQueries.markWizardCompleted();
        setupStateQueries.markChecklistDismissed();

        assertEquals(setupStateQueries.reopenWizard('link-database'), true);
        const once = setupStateQueries.getWizardState();
        assertEquals(setupStateQueries.reopenWizard('link-database'), true);

        assertEquals(setupStateQueries.getWizardState(), once);
        assertEquals(once, { completed: false, dismissedAt: null, currentStep: 'link-database' });
        assertEquals(setupStateQueries.isChecklistDismissed(), false);
        assertEquals(setupStateQueries.wizardShouldRun(), true);
        assertThrows(() => setupStateQueries.reopenWizard('nope' as WizardStep), Error, 'Invalid wizard step');
      });
    });

    this.test('markChecklistDismissed is idempotent and keeps the first timestamp', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        assertEquals(setupStateQueries.isChecklistDismissed(), false);
        db.execute("UPDATE setup_state SET setup_checklist_dismissed_at = '2026-01-01 00:00:00' WHERE id = 1");
        assertEquals(setupStateQueries.markChecklistDismissed(), true);
        assertEquals(setupStateQueries.get().setup_checklist_dismissed_at, '2026-01-01 00:00:00');
        assertEquals(setupStateQueries.isChecklistDismissed(), true);
      });
    });

    // ---- resolveResumeStep ----

    this.test('resolveResumeStep returns the first incomplete step', () => {
      assertEquals(
        resolveResumeStep({ hasArrInstance: false, hasDatabase: true, hasProfileSelections: true }),
        'connect-arr'
      );
      assertEquals(
        resolveResumeStep({ hasArrInstance: true, hasDatabase: false, hasProfileSelections: true }),
        'link-database'
      );
      assertEquals(
        resolveResumeStep({ hasArrInstance: true, hasDatabase: true, hasProfileSelections: false }),
        'select-profiles'
      );
      assertEquals(
        resolveResumeStep({ hasArrInstance: true, hasDatabase: true, hasProfileSelections: true }),
        'preview-sync'
      );
    });

    // ---- resolveSetupChecklist ----

    this.test('resolveSetupChecklist shows k/3 progress only after a skip, outside wizard/auth', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        this.patch(arrInstancesQueries, 'getAll', () => []);
        this.patch(arrInstancesQueries, 'getEnabled', () => []);
        this.patch(databaseInstancesQueries, 'getAll', () => []);

        assertEquals(resolveSetupChecklist('/'), null, 'hidden before the wizard is skipped');

        setupStateQueries.markWizardDismissed();
        assertEquals(resolveSetupChecklist('/'), {
          progress: { hasArrInstance: false, hasDatabase: false, hasProfileSelections: false },
          completedCount: 0,
          total: 3,
          primaryInstanceId: null,
        });
        assertEquals(resolveSetupChecklist('/setup/welcome'), null, 'hidden inside the wizard');
        assertEquals(resolveSetupChecklist('/auth/login'), null, 'hidden on auth pages');
      });
    });

    this.test('resolveSetupChecklist hides once dismissed or completed', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        this.patch(arrInstancesQueries, 'getAll', () => []);
        this.patch(arrInstancesQueries, 'getEnabled', () => []);
        this.patch(databaseInstancesQueries, 'getAll', () => []);
        setupStateQueries.markWizardDismissed();

        setupStateQueries.markChecklistDismissed();
        assertEquals(resolveSetupChecklist('/'), null, 'hidden after permanent dismissal');

        setupStateQueries.reopenWizard('connect-arr');
        setupStateQueries.markWizardDismissed();
        setupStateQueries.markWizardCompleted();
        assertEquals(resolveSetupChecklist('/'), null, 'hidden after completion');
      });
    });

    this.test('resolveSetupChecklist hides when every prerequisite is met', async (context) => {
      await this.withSetupStateDatabase(context, () => {
        // Progress and primary-instance resolution only read `id` from these rows.
        const instance = { id: 3 } as unknown as ArrInstance;
        const database = { id: 1 } as unknown as DatabaseInstance;
        let selections: QualityProfilesSyncData['selections'] = [];
        this.patch(arrInstancesQueries, 'getAll', () => [instance]);
        this.patch(arrInstancesQueries, 'getEnabled', () => [instance]);
        this.patch(databaseInstancesQueries, 'getAll', () => [database]);
        this.patch(
          arrSyncQueries,
          'getQualityProfilesSync',
          () => ({ selections }) as unknown as QualityProfilesSyncData
        );
        setupStateQueries.markWizardDismissed();

        const partial = resolveSetupChecklist('/');
        assertEquals(partial?.completedCount, 2);
        assertEquals(partial?.primaryInstanceId, 3);

        selections = [{ databaseId: 1, profileName: 'HD' }];
        assertEquals(resolveSetupChecklist('/'), null);
      });
    });

    // ---- getSetupProgress ----

    this.test('getSetupProgress reports nothing configured for a fresh install', () => {
      this.patch(arrInstancesQueries, 'getAll', () => []);
      this.patch(databaseInstancesQueries, 'getAll', () => []);

      assertEquals(getSetupProgress(), {
        hasArrInstance: false,
        hasDatabase: false,
        hasProfileSelections: false,
      });
    });

    // ---- resolveWizardRedirect ----

    this.test('resolveWizardRedirect sends bare navigations to /setup while the wizard is running', () => {
      this.patch(setupStateQueries, 'wizardShouldRun', () => true);
      assertEquals(resolveWizardRedirect(buildNavigationEvent('/', 'GET')), '/setup');
    });

    this.test('resolveWizardRedirect never redirects /api/* paths', () => {
      this.patch(setupStateQueries, 'wizardShouldRun', () => true);
      assertEquals(resolveWizardRedirect(buildNavigationEvent('/api/v1/foo', 'GET')), null);
    });

    this.test('resolveWizardRedirect never redirects /setup/* (owned by the wizard layout)', () => {
      this.patch(setupStateQueries, 'wizardShouldRun', () => true);
      assertEquals(resolveWizardRedirect(buildNavigationEvent('/setup/welcome', 'GET')), null);
    });

    this.test('resolveWizardRedirect only gates GET navigations', () => {
      this.patch(setupStateQueries, 'wizardShouldRun', () => true);
      assertEquals(resolveWizardRedirect(buildNavigationEvent('/', 'POST')), null);
    });

    this.test('resolveWizardRedirect does not redirect once the wizard has finished', () => {
      this.patch(setupStateQueries, 'wizardShouldRun', () => false);
      assertEquals(resolveWizardRedirect(buildNavigationEvent('/', 'GET')), null);
    });

    // ---- assertSetupInProgress ----

    this.test('assertSetupInProgress throws 403 once the wizard is no longer running', () => {
      this.patch(setupStateQueries, 'wizardShouldRun', () => false);

      let caught: unknown;
      try {
        assertSetupInProgress();
      } catch (err) {
        caught = err;
      }

      assertExists(caught);
      assertEquals((caught as { status: number }).status, 403);
    });

    this.test('assertSetupInProgress does not throw while the wizard is running', () => {
      this.patch(setupStateQueries, 'wizardShouldRun', () => true);
      assertSetupInProgress();
    });
  }
}

const test = new SetupProgressTest();
await test.runTests();
