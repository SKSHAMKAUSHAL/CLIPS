import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

export async function checkDependencies() {
  const status = {
    ffmpeg: { installed: false, version: 'Missing' },
    ytdlp: { installed: false, version: 'Missing' },
    ollama: { installed: false, version: 'Missing' }
  };

  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version']);
    status.ffmpeg = { installed: true, version: stdout.split('\n')[0].substring(0, 30) };
  } catch (e) {}

  try {
    const { stdout } = await execFileAsync('yt-dlp', ['--version']);
    status.ytdlp = { installed: true, version: stdout.trim() };
  } catch (e) {}

  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (res.ok) {
      status.ollama = { installed: true, version: 'Connected' };
    }
  } catch (e) {}

  return status;
}
