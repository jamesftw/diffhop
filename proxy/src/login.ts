/**
 * `npm run login` — authenticate via GitHub Device Flow and save the token.
 * No manual PAT generation: approve a short code at github.com/login/device.
 */
import { GITHUB_CLIENT_ID, OAUTH_SCOPE, TOKEN_FILE } from './config';
import { requestDeviceCode, pollForToken, saveToken } from './auth';

async function main(): Promise<void> {
  const device = await requestDeviceCode(GITHUB_CLIENT_ID, OAUTH_SCOPE);

  console.log('\n  To authorize diffhop:');
  console.log(`    1. Open  ${device.verification_uri}`);
  console.log(`    2. Enter code  ${device.user_code}\n`);
  console.log('  Waiting for authorization…');

  const token = await pollForToken(GITHUB_CLIENT_ID, device.device_code, device.interval);
  saveToken(token);

  console.log(`\n  ✓ Authenticated. Token saved to ${TOKEN_FILE}`);
  console.log('  Start the proxy with:  npm start\n');
}

main().catch((err) => {
  console.error(`\n  Login failed: ${err.message}\n`);
  process.exit(1);
});
