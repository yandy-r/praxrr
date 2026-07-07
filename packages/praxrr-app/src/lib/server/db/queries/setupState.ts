import { db } from '../db.ts';

/**
 * Types for setup_state table
 */
export interface SetupState {
  id: number;
  default_database_linked: number;
  wizard_completed: number;
  wizard_dismissed_at: string | null;
  wizard_current_step: WizardStep;
  created_at: string;
  updated_at: string;
}

export type WizardStep =
  | 'welcome'
  | 'connect-arr'
  | 'link-database'
  | 'select-profiles'
  | 'preview-sync'
  | 'done';

const WIZARD_STEPS: WizardStep[] = [
  'welcome',
  'connect-arr',
  'link-database',
  'select-profiles',
  'preview-sync',
  'done',
];

/**
 * All queries for setup_state table
 * Singleton pattern - only one state record exists
 */
export const setupStateQueries = {
  /**
   * Get setup state (singleton)
   */
  get(): SetupState {
    const state = db.queryFirst<SetupState>('SELECT * FROM setup_state WHERE id = 1');
    if (!state) {
      throw new Error('Setup state not found - database may not be initialized');
    }
    return state;
  },

  /**
   * Check if default database has been linked
   */
  isDefaultDatabaseLinked(): boolean {
    return this.get().default_database_linked === 1;
  },

  /**
   * Mark default database as linked
   */
  markDefaultDatabaseLinked(): boolean {
    const affected = db.execute(
      'UPDATE setup_state SET default_database_linked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    );
    return affected > 0;
  },

  /**
   * Get wizard state (singleton)
   */
  getWizardState(): { completed: boolean; dismissedAt: string | null; currentStep: WizardStep } {
    const state = this.get();
    return {
      completed: state.wizard_completed === 1,
      dismissedAt: state.wizard_dismissed_at,
      currentStep: state.wizard_current_step,
    };
  },

  /**
   * Advance the wizard to a given step
   */
  setWizardStep(step: WizardStep): boolean {
    if (!WIZARD_STEPS.includes(step)) {
      throw new Error(`Invalid wizard step: ${step}`);
    }
    const affected = db.execute(
      'UPDATE setup_state SET wizard_current_step = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      step
    );
    return affected > 0;
  },

  /**
   * Mark the wizard as completed
   */
  markWizardCompleted(): boolean {
    const affected = db.execute(
      'UPDATE setup_state SET wizard_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    );
    return affected > 0;
  },

  /**
   * Mark the wizard as dismissed
   */
  markWizardDismissed(): boolean {
    const affected = db.execute(
      'UPDATE setup_state SET wizard_dismissed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    );
    return affected > 0;
  },

  /**
   * Whether the wizard should run - not yet completed and not dismissed
   */
  wizardShouldRun(): boolean {
    const { completed, dismissedAt } = this.getWizardState();
    return !completed && dismissedAt === null;
  },
};
