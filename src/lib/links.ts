/**
 * Outbound links to the project itself.
 *
 * One constant rather than a literal at each call site: the app menu and the
 * welcome screen both point here, and a fork should have exactly one line to
 * change. Kept in sync by hand with `repository.url` in package.json — the
 * manifest form there is a `git+` clone URL, not a browsable one.
 */
export const REPO_URL = 'https://github.com/ntson9p/marknow';
