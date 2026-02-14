/**
 * Example test demonstrating BaseTest usage
 * Shows how to extend BaseTest and use its utilities
 */

import { BaseTest, TestContext } from './base/BaseTest.ts';
import { assertEquals } from '@std/assert';

class ExampleTest extends BaseTest {
  // Optional: Run once before all tests
  protected override beforeAll(): void {
    console.log('ExampleTest: beforeAll - runs once before all tests');
  }

  // Optional: Run once after all tests
  protected override afterAll(): void {
    console.log('ExampleTest: afterAll - runs once after all tests');
  }

  // Optional: Run before each test
  protected override beforeEach(context: TestContext): void {
    console.log(`ExampleTest: beforeEach - test: ${context.name}, tempDir: ${context.tempDir}`);
  }

  // Optional: Run after each test
  protected override afterEach(context: TestContext): void {
    console.log(`ExampleTest: afterEach - test: ${context.name}`);
  }

  // Define your tests
  runTests(): void {
    // Basic test
    this.test('basic assertion', () => {
      assertEquals(1 + 1, 2);
    });

    // Test with temp directory
    this.test('temp directory is created', async (context) => {
      // Each test gets its own temp directory
      await this.assertFileExists(context.tempDir);
    });

    // Test file operations
    this.test('can write and read files', async (context) => {
      const testFile = `${context.tempDir}/test.txt`;

      // Write to file
      await Deno.writeTextFile(testFile, 'Hello, World!');

      // Assert file exists
      await this.assertFileExists(testFile);

      // Assert file contains expected text
      await this.assertFileContains(testFile, 'Hello, World!');

      // Assert file matches pattern
      await this.assertFileMatches(testFile, /Hello.*World/);
    });

    // Test JSON operations
    this.test('can write and read JSON lines', async (context) => {
      const jsonFile = `${context.tempDir}/data.jsonl`;

      // Write JSON lines
      await Deno.writeTextFile(
        jsonFile,
        JSON.stringify({ id: 1, name: 'test' }) + '\n' + JSON.stringify({ id: 2, name: 'example' }) + '\n'
      );

      // Read JSON lines
      const data = await this.readJsonLines(jsonFile);

      assertEquals(data.length, 2);
      assertEquals((data[0] as { id: number }).id, 1);
      assertEquals((data[1] as { id: number }).id, 2);
    });

    // Test async operations
    this.test('waitFor utility works', async () => {
      let counter = 0;

      // Start async operation
      setTimeout(() => {
        counter = 5;
      }, 100);

      // Wait for condition
      await this.waitFor(() => counter === 5, 1000);

      assertEquals(counter, 5);
    });

    // Test waitForFile utility
    this.test('waitForFile utility works', async (context) => {
      const testFile = `${context.tempDir}/delayed.txt`;

      // Create file after delay
      setTimeout(async () => {
        await Deno.writeTextFile(testFile, 'delayed content');
      }, 100);

      // Wait for file to exist
      await this.waitForFile(testFile, 1000);

      // File should exist now
      await this.assertFileExists(testFile);
    });

    // Test file NOT exists assertion
    this.test('assertFileNotExists works', async (context) => {
      const nonExistentFile = `${context.tempDir}/does-not-exist.txt`;

      // Should pass - file doesn't exist
      await this.assertFileNotExists(nonExistentFile);
    });
  }
}

// Create instance and run tests
const exampleTest = new ExampleTest();
await exampleTest.runTests();
