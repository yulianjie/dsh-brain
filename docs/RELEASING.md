# Release checklist

The published npm package is `@yulianjie/dsh-brain`; the unscoped name belongs to
another project. Releases use `yulianjie-dsh-brain-<version>.tgz` and `SHA256SUMS.txt`.
Publish the same tarball to GitHub and npm; do not rebuild independently afterward.

1. Review changes, dependency licenses and the data schema. Keep `package.json`
   and `package-lock.json` versions aligned; update `CHANGELOG.md` and installation
   examples for a new version. Use a new version for a published package whose
   contents changed; never silently replace an existing release asset.
2. From a clean checkout run `npm ci`, `npm run verify` and `git diff --check`.
   Require all six GitHub CI jobs to pass for the exact candidate commit.
3. For host integration changes, run `npm run test:runtime` against the declared
   Desktop bundled runtime. Check the native settings UI if affected; record which
   platform/runtime was tested and whether real network models were used.
4. Review `git ls-files` and the `npm pack --dry-run` inventory. Exclude stores,
   exports, credentials, profiles, local runtime copies and unrelated artifacts.
5. Run `npm pack` from the candidate checkout. On Windows compute a checksum with
   `Get-FileHash .\yulianjie-dsh-brain-<version>.tgz -Algorithm SHA256`. The archive includes
   source, installation scripts, documentation, `LICENSE` and `NOTICE`; dependencies
   are resolved by npm and are not vendored into the tarball.
6. If publishing a release, create a matching `v<version>` tag and upload that exact
   archive and checksum with release notes. Download the published archive and
   compare the checksum, version, license and file inventory. Exercise installation
   and uninstallation in an isolated `DSH_HOME` and profile.
7. Publish the tested tarball with `npm publish <tarball> --access public --tag latest`
   only under an authorized account. Complete any npm interactive authentication.
   Download the registry tarball, verify `dist.integrity` and SHA256 equality with
   GitHub, then install the exact version in an isolated profile. Never put npm
   tokens in repository files or general-purpose logs.

Use `DSH_BRAIN_PACKAGE_DIR` with `npm run test:runtime` to validate the installed
package instead of workspace source. The runtime smoke resolves the actual scoped
package through the host loader and checks the client module ID. Keep runtime, native
UI and real model verification claims separate.

The portable CI checks cover core/adapter/client boundary tests and package
installation. Desktop is not installed in hosted CI, so a green workflow is not
evidence of native Desktop compatibility on Linux or macOS.
