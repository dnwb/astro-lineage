# Test Workspace Lifecycle and Hygiene

## Contract

All tests that create temporary filesystem workspaces must guarantee deterministic cleanup to protect against `/tmp` inode and disk exhaustion.

1. **Workspace Allocation**:
   - Always allocate temporary scratch directories using `createTemporaryWorkspace(prefix, t)` from `tests/helpers/temporary-workspace.mjs`.
   - Pass the test context `t` so that `t.after(cleanup)` is automatically registered on test completion.
   - For loops within a single test, either invoke `await cleanup()` explicitly at loop iteration boundaries or rely on `t.after()`.

2. **Pre-test and Post-test Sweeps**:
   - `package.json` includes `pretest` and `posttest` lifecycle hooks calling `scripts/cleanup-test-tmp.mjs`.
   - Any unclosed `astro-lineage-*` scratch directories left over from aborted or cancelled runs are swept automatically.

3. **No Heavy or Unused Dependencies**:
   - Bot clients and testing mocks must rely on Node.js built-ins (`node:test`, `node:assert`, `fetch`, native `ws`) without installing unused SDK wrappers.
