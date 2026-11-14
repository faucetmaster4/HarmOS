/* Resolves Vite's `?raw` suffix (and raw-text assets) for the render smoke test. */
const RAW = /\?raw$/;
const RAW_EXT = /\.(hcl|service|sh|timer|conf|ps1)$/;

export async function resolve(specifier, context, next) {
  if (RAW.test(specifier)) {
    return { shortCircuit: true, url: 'data:text/javascript,export default ""' };
  }
  if (RAW_EXT.test(new URL(specifier, context.parentURL ?? 'file:///').pathname)) {
    return { shortCircuit: true, url: 'data:text/javascript,export default ""' };
  }
  return next(specifier, context);
}
