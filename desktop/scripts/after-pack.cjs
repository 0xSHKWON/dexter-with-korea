/**
 * Ad-hoc codesign the macOS .app after electron-builder packs it.
 *
 * Why: on Apple Silicon an *unsigned* app downloaded from the internet (quarantine
 * flag set) fails with "'Dexter' is damaged and can't be opened" — and that dialog
 * offers no "Open anyway". An ad-hoc signature (`codesign --sign -`, no certificate)
 * makes the binary valid, so Gatekeeper downgrades it to the normal "unidentified
 * developer" prompt where right-click → Open works. Real cert + notarization later
 * removes the prompt entirely.
 */
const { execSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`[after-pack] ad-hoc signing ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
};
