# Command Notes

The rollout checklist parity test commands require explicit Deno permissions in this environment.

Executed parity gate commands:

- `deno test --allow-env --allow-read --allow-write --allow-ffi packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`
- `deno test --allow-env --allow-read --allow-write --allow-ffi packages/praxrr-app/src/tests/jobs/hybridSyncTrigger.test.ts`
