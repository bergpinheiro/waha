/**
 * The library's public subpaths, declared for this project's compiler.
 *
 * zapo-js publishes fourteen entry points through its package exports map,
 * and its crypto primitives live behind one of them. Node honours that map at
 * runtime - `require('zapo-js/crypto')` resolves, and the deep path it points
 * at is refused with ERR_PACKAGE_PATH_NOT_EXPORTED - but this project compiles
 * with `module: commonjs` and a resolution mode that predates exports maps, so
 * the same specifier does not type-check.
 *
 * Rather than change the compiler options every workspace shares, the mapping
 * is declared here: the types come from the file the subpath points at, and
 * the import that reaches the runtime stays the public one. Anything the
 * engine needs from another subpath is added the same way.
 *
 * If this project ever moves to `node16`/`bundler` resolution, this file
 * becomes redundant and can go.
 */
declare module 'zapo-js/crypto' {
  export * from 'zapo-js/dist/crypto';
}
