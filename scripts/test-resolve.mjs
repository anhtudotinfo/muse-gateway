// Lets `node --test` load the app's extensionless imports (`./speech`), which
// Next resolves but Node's ESM loader doesn't: a relative import without an
// extension is retried as `.ts`.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw err;
    }
  },
});
