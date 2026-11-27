/**
 * dsh-sidebar-entries — Host half.
 *
 * Pure UI plugin: the browser half ships through `exports["./client"]`, is
 * discovered from the `dsh.client` declaration, and is served by
 * `@deepseek-ai/dsh-client-modules`. The empty `apply` exists only so the
 * plugin appears in the host Loader.
 */
export function apply() {}
