// Lets tests import .astro components (render tests via the container API) under plain tsc.
declare module '*.astro' {
  const component: import('astro/runtime/server/index.js').AstroComponentFactory;
  export default component;
}
