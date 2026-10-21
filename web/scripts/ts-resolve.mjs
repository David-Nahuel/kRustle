// Para ejecutar con Node scripts que importan el motor: sus imports relativos van sin extensión
// (como los escribe Angular), así que si uno no existe tal cual se prueba con ".ts".
//
//   node --import ./scripts/ts-resolve.mjs scripts/validate-pick.ts
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.{1,2}\//.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
