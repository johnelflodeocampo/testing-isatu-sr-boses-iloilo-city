const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const createGasApiClient = require('../utils/gasApi');
const isatuEmailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$/i;

function showUsage() {
  console.log('Usage: node scripts/testGasEmail.js --to <isatu-email> [--send]');
  console.log('       node scripts/testGasEmail.js --check');
  console.log('Without --send, the script does not make a request or send email.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    showUsage();
    return;
  }

  if (args.includes('--check')) {
    if (args.length !== 1) {
      showUsage();
      process.exitCode = 2;
      return;
    }
    await createGasApiClient(null).checkAuthorization();
    console.log('GAS shared-secret check passed. No email was sent.');
    return;
  }

  const recipientIndex = args.indexOf('--to');
  const recipient = recipientIndex >= 0 ? args[recipientIndex + 1] : '';
  if (!recipient || recipient.startsWith('--')
    || args.some((argument) => !['--to', recipient, '--send'].includes(argument))) {
    showUsage();
    process.exitCode = 2;
    return;
  }
  if (!isatuEmailPattern.test(recipient)) {
    console.error('Test email recipient must be an ISAT U email address.');
    process.exitCode = 2;
    return;
  }

  const shouldSend = args.includes('--send');
  if (!shouldSend) {
    console.log(`Dry run only. No email was sent to ${recipient}.`);
    return;
  }

  const client = createGasApiClient(null);
  await client.sendTestEmail(recipient);
  console.log(`Test email sent to ${recipient}.`);
}

main().catch((error) => {
  console.error('GAS test email failed:', error.message);
  process.exitCode = 1;
});
