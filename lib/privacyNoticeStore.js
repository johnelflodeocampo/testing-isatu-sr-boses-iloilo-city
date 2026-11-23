const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const noticeDirectory = path.join(__dirname, '..', 'notice');
const noticeFile = path.join(noticeDirectory, 'notice.txt');

async function read() {
  let contents;
  try {
    contents = await fs.readFile(noticeFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  let notice;
  try {
    notice = JSON.parse(contents);
  } catch {
    throw new Error('The privacy notice file is not valid JSON.');
  }
  if (!notice || typeof notice.title !== 'string'
    || typeof notice.body !== 'string' || typeof notice.updated_at !== 'string') {
    throw new Error('The privacy notice file has an invalid format.');
  }
  return notice;
}

async function write(notice) {
  await fs.mkdir(noticeDirectory, { recursive: true });
  const temporaryFile = `${noticeFile}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(notice, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporaryFile, noticeFile);
  } catch (error) {
    try {
      await fs.unlink(temporaryFile);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

async function remove() {
  try {
    await fs.unlink(noticeFile);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

module.exports = { read, write, remove };
