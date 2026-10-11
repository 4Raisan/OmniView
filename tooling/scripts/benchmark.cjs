const { _electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function audio(bytes = 64 * 1024 * 1024) {
  const wav = Buffer.alloc(bytes + 44);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  return wav;
}
async function run(executable, count = 3) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mv-benchmark-'));
  const code = Array.from({length: 2500}, (_, i) => `def calculation_${i}(value): return value + ${i}`).join('\n');
  const textPaths = Array.from({length: 12}, (_, i) => path.join(root, `document-${i}.py`));
  await Promise.all(textPaths.map(file => fs.writeFile(file, code)));
  const markdown = path.join(root, 'benchmark.md');
  await fs.writeFile(markdown, '# Benchmark\n\n' + ('Text with **formatting** and a searchable needle.\n\n'.repeat(200)));
  const media = path.join(root, 'audio-64MiB.wav'); await fs.writeFile(media, audio());
  const rows = [];
  let appVersion;
  for (let iteration = 0; iteration < count; iteration++) {
    const start = performance.now();
    const app = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${path.join(root, 'profile-' + iteration)}`] });
    try {
      const page = await app.firstWindow(); await page.waitForSelector('#btn-hero-browse');
      appVersion = await app.evaluate(({app}) => app.getVersion());
      const startupMs = performance.now() - start;
      const metrics = () => app.evaluate(({app}) => app.getAppMetrics().map(({pid,type,memory,cpu}) => ({pid,type,memory,cpu})));
      const record = async (scenario, extras = {}) => {
        const cpuBefore = await metrics(); const sampleStart = performance.now();
        await pause(500);
        const processes = await metrics();
        const cpuSeconds = processes.reduce((sum,p) => sum + Math.max(0, p.cpu.cumulativeCPUUsage - (cpuBefore.find(before => before.pid === p.pid)?.cpu.cumulativeCPUUsage || 0)), 0);
        rows.push({ iteration, scenario, ...extras, privateMiB: processes.reduce((sum,p) => sum + p.memory.privateBytes,0)/1024,
          workingSetMiB: processes.reduce((sum,p) => sum + p.memory.workingSetSize,0)/1024,
          cpuPercent:100 * cpuSeconds / ((performance.now()-sampleStart)/1000) / os.cpus().length,
          rendererPrivateMiB: processes.filter(p=>p.type==='Tab').reduce((sum,p)=>sum+p.memory.privateBytes,0)/1024, processes });
      };
      const open = async files => {
        await app.evaluate(({dialog}, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files);
        await page.locator('#btn-open-file').click();
        await page.waitForFunction(name => document.querySelector('#status-filename').textContent === name, path.basename(files.at(-1)));
      };
      await record('idle', {startupMs});
      const before = await metrics(); const cpuStart = performance.now(); await pause(2000); const after = await metrics();
      const delta = after.reduce((sum,p)=>sum+p.cpu.cumulativeCPUUsage,0) - before.reduce((sum,p)=>sum+p.cpu.cumulativeCPUUsage,0);
      rows.at(-1).idleCpuPercent = 100 * delta / ((performance.now()-cpuStart)/1000) / os.cpus().length;
      let opened = performance.now(); await open([textPaths[0]]); await page.waitForSelector('.code-line');
      await record('one-code-tab', {openMs: performance.now()-opened});
      opened = performance.now(); await open(textPaths.slice(1));
      await page.waitForFunction(() => document.querySelectorAll('.file-tab').length === 12);
      await page.waitForSelector('.code-line');
      const searchMs = await page.evaluate(() => {
        const input=document.querySelector('.toolbar-search input'); const samples=[];
        for(const query of ['value','return','calculation','123','value']) { const start=performance.now();input.value=query;input.dispatchEvent(new Event('input'));samples.push(performance.now()-start); }
        return samples.sort((a,b)=>a-b)[2];
      });
      await record('twelve-code-tabs', {openBatchMs: performance.now()-opened, searchMs});
      await open([markdown]); await page.waitForSelector('.markdown-body'); await record('markdown');
      await open([media]); await page.waitForFunction(()=>document.querySelector('audio')?.readyState >= 1);
      await record('64MiB-audio-paused');
      await page.locator('audio').evaluate(el=>el.play()); await record('64MiB-audio-playing');
      const closeStart = performance.now();
      for(let i=0;i<14;i++) await page.keyboard.press('Control+w');
      await page.waitForSelector('#btn-hero-browse'); await record('all-tabs-closed', {closeMs: performance.now()-closeStart});
    } finally { await app.close(); }
  }
  return { date: new Date().toISOString(), executableVersion: appVersion, machine: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0].model, logicalCpus:os.cpus().length, totalRamGiB:os.totalmem()/2**30 }, iterations:count,
    methodology:'Fresh profiles. All Electron processes; private memory and working sets in MiB. Working-set sums can double-count shared pages. Synthetic 2500-line Python files, 12 tabs, 200-paragraph Markdown and 64 MiB PCM audio. Scenario CPU is sampled over 500 ms, idle CPU over two seconds; both are divided by logical CPU count. File bytes remain local.', rows };
}
async function runEditing(executable, count) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mv-edit-benchmark-'));
  const small = path.join(root, 'live.md'), large = path.join(root, 'large.txt');
  await fs.writeFile(small, '# Live preview\n\n' + 'A paragraph with **formatting**.\n\n'.repeat(200));
  await fs.writeFile(large, ('line ' + 'x'.repeat(1950) + '\n').repeat(1000));
  const rows = [];
  for (let iteration = 0; iteration < count; iteration++) {
    const app = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${path.join(root, 'profile-' + iteration)}`] });
    try {
      const page = await app.firstWindow(); await page.waitForSelector('#btn-hero-browse');
      for (const [scenario, file] of [['markdown-live', small], ['1.87MiB-text-edit', large]]) {
        await app.evaluate(({dialog}, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
        await page.locator('#btn-open-file').click();
        await page.getByRole('button', { name:'Edit', exact:true }).click();
        if (scenario === 'markdown-live') await page.getByRole('button', { name:'Live split', exact:true }).click();
        const inputHandlerMs = await page.getByLabel('Edit document text').evaluate(area => {
          const times=[];
          for(let i=0;i<10;i++) {area.value += 'x';const start=performance.now();area.dispatchEvent(new Event('input'));times.push(performance.now()-start);}
          return times.sort((a,b)=>a-b)[5];
        });
        let previewLatencyMs;
        if(scenario==='markdown-live') {
          const start=performance.now();
          await page.getByLabel('Edit document text').evaluate(area=>{area.value='# Updated preview\n\n'+area.value;area.dispatchEvent(new Event('input'));});
          await page.locator('.live-edit-split .markdown-body h1').first().waitFor();
          await page.waitForFunction(()=>document.querySelector('.live-edit-split .markdown-body h1')?.textContent==='Updated preview');
          previewLatencyMs=performance.now()-start;
        }
        await pause(500);
        const processes=await app.evaluate(({app})=>app.getAppMetrics());
        rows.push({iteration,scenario,inputHandlerMs,previewLatencyMs,sourceBytes:(await fs.stat(file)).size,
          privateMiB:processes.reduce((sum,p)=>sum+p.memory.privateBytes,0)/1024,
          workingSetMiB:processes.reduce((sum,p)=>sum+p.memory.workingSetSize,0)/1024});
        await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
        await page.keyboard.press('Control+w'); await page.waitForSelector('#btn-hero-browse');
      }
    } finally { await app.close(); }
  }
  return {date:new Date().toISOString(), iterations:count,
    methodology:'Fresh profiles, small Markdown live split followed by 1.87 MiB plain text editing. Input-handler time is synchronous dispatch of ten synthetic input events, not physical keyboard latency. Preview latency includes the 250 ms debounce and automation observation. Memory is the sum of all Electron processes; working sets can double-count shared pages.',rows};
}
const executable = path.resolve(process.argv[2] || 'release/win-unpacked/OmniView.exe');
(process.argv[5] === 'editing' ? runEditing : run)(executable, Number(process.argv[4] || 3)).then(async report => {
  const output = process.argv[3] || 'benchmark-results.json'; await fs.writeFile(output, JSON.stringify(report,null,2));
  console.log(JSON.stringify({output, scenarios:report.rows.map(({iteration,scenario,privateMiB,startupMs,searchMs,inputHandlerMs,previewLatencyMs})=>({iteration,scenario,privateMiB,startupMs,searchMs,inputHandlerMs,previewLatencyMs}))}));
}).catch(error=>{console.error(error);process.exitCode=1});
