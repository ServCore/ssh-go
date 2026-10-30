import type { Page } from '@playwright/test';

// These IPC fixtures test frontend behavior only. Go tests exercise real SSH/SFTP.
export async function desktopFixture(page: Page, largeDirectory = false, needsPassword = false, gallery = false, platform = 'macos', slowServices = false) {
  await page.addInitScript(({ largeDirectory, needsPassword, gallery, platform, slowServices }) => {
    const w = window as any;
    let transferId = 0;
    let sessionCounter = 0;
    let terminalCounter = 0;
    let copyCounter = 0;
    let knownHosts = [{address:"127.0.0.1",port:2222,fingerprint:"SHA256:qa"}];
    const forwards: any[] = [];
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    let hosts = JSON.parse(localStorage.getItem('qa-hosts') || 'null') || [{ id: 'qa-host', name: '测试服务器', address: '127.0.0.1', port: 2222, username: 'test', group: '测试', rememberPassword: !needsPassword }];
    if (gallery && !localStorage.getItem('qa-hosts')) {
      hosts = [...hosts, ...[
        ['ubuntu', 'Ubuntu', '24.04', '生产 API'],
        ['debian', 'Debian', '12', '数据库'],
        ['rocky', 'Rocky Linux', '9.5', '测试环境'],
        ['windows', 'Windows', null, 'Windows 构建机'],
        ['macos', 'macOS', '15.0', 'macOS 构建机'],
        ['alpine', 'Alpine Linux', '3.21', '服务器名称很长时也能保持卡片整齐_这是用于布局验证的测试服务器'],
      ].map(([id, name, version, label]) => ({ id, name: label, address: `${id}.example.internal`, port: 22, username: 'developer', group: id === 'ubuntu' || id === 'debian' ? '生产' : '开发', rememberPassword: true, remoteSystem: { id, name, version } }))];
    }
    const sessions = new Map<string, any>();
    const preferences = JSON.parse(localStorage.getItem('qa-preferences') || '{}');
    let releaseServices: (() => void) | undefined;
    const servicesReady = slowServices ? new Promise<void>((resolve) => { releaseServices = resolve; }) : Promise.resolve();
    let extensions = [
      { id: 'caddy', name: 'Caddy', category: 'Web 服务', summary: '自动 HTTPS 的现代 Web 服务，可由 SSH Tools 使用独立配置启动。', version: 'Homebrew 最新', platform: 'macos', sourceUrl: 'https://formulae.brew.sh/formula/caddy', provider: 'homebrew', formula: 'caddy', serviceName: 'caddy', installable: true, unavailableReason: null, installedVersion: null, serviceStatus: null },
      { id: 'nginx', name: 'Nginx', category: 'Web 服务', summary: '高性能 Web 与反向代理服务。', version: 'Homebrew 最新', platform: 'macos', sourceUrl: 'https://formulae.brew.sh/formula/nginx', provider: 'homebrew', formula: 'nginx', serviceName: 'nginx', installable: true, unavailableReason: null, installedVersion: null, serviceStatus: null },
      { id: 'frpc', name: 'FRP 客户端', category: '内网穿透', summary: '将本机服务安全转发到公网，由 Homebrew Services 持续运行。', version: 'Homebrew 最新', platform: 'macos', sourceUrl: 'https://formulae.brew.sh/formula/frpc', provider: 'homebrew', formula: 'frpc', serviceName: 'frpc', installable: true, unavailableReason: null, installedVersion: null, serviceStatus: null },
      { id: 'php-8.4', name: 'PHP 8.4', category: 'PHP', summary: 'PHP-FPM 运行时，可按网站绑定版本。', version: 'Homebrew 最新', platform: 'macos', sourceUrl: 'https://formulae.brew.sh/formula/php@8.4', provider: 'homebrew', formula: 'php@8.4', serviceName: 'php-8.4', installable: true, unavailableReason: null, installedVersion: null, serviceStatus: null },
    ];
    const longName = '这是一份需要完整查看的文件名称_'.repeat(9) + '_最终版本.tar.gz';
    const entries = (path: string) => largeDirectory ? Array.from({ length: 10000 }, (_, index) => ({ name: `item-${String(index).padStart(5, '0')}.txt`, path: `${path}/item-${String(index).padStart(5, '0')}.txt`, kind: 'file', size: index, modified: 1700000000 })) : path.endsWith('/empty') ? [] : [
      { name: 'empty', path: `${path}/empty`, kind: 'directory', size: 0, modified: 1700000000 },
      { name: 'notes.txt', path: `${path}/notes.txt`, kind: 'file', size: 32, modified: 1700000000 },
      { name: longName, path: `${path}/${longName}`, kind: 'file', size: 65536, modified: 1700000000 },
    ];
    w.__qa = {
      releaseServices: () => releaseServices?.(),
      calls: [] as any[], recoveries: [] as any[], recoveryReadError: null as string | null, recoveryActionError: null as string | null, transfer: null as any, terminal: null as any, filesToUpload: [] as string[], selectedFile: null as string | null, savePath: null as string | null, importPreview: {hosts:[],warnings:[]} as any, confirmResult: null as string | null, failSource: null as string | null, queueLimit: Infinity, failAuthNext: false, detectFailure: false, pauseDetection: false, finishDetection: null as (() => void) | null,
      emit(name: string, payload: unknown) { for (const cb of listeners.get(name) || []) cb(payload); },
    };
    w.runtime = {
      EventsOn(name: string, callback: (payload: unknown) => void) {
        const set = listeners.get(name) || new Set();
        set.add(callback); listeners.set(name, set);
        return () => { set.delete(callback); if (!set.size) listeners.delete(name); };
      },
    };
    w.go = { main: { App: {
      Call: (command: string, args: any) => w.__qa.invoke(command, args),
    } } };
    Object.assign(w.__qa, {
      async invoke(command: string, args: any = {}) {
        // Never retain passwords in the fixture's call history.
        w.__qa.calls.push({ command, args: { ...args, apiKey: undefined, password: undefined, passwordSupplied: Boolean(args.password), onEvent: undefined } });
        if (command === 'dialog_confirm') return w.__qa.confirmResult !== '取消';
        if (command === 'dialog_open') return args.multiple ? w.__qa.filesToUpload : w.__qa.selectedFile;
        if (command === 'dialog_save') return w.__qa.savePath;
        if (command === 'list_ai_providers') return { providers:[{id:'legacy',name:'原终端 AI',endpoint:'https://api.deepseek.com/v1',model:'deepseek-chat',protocol:'chat',hasApiKey:false}],defaultId:'legacy' };
        if (command === 'browser_layout') return;
        // Real IPC returns a serialized snapshot, never the fixture's mutable array.
        if (command === 'list_hosts') return structuredClone(hosts);
        if (command === 'get_host_password') return hosts.find((host: any) => host.id === args.id)?.rememberPassword ? 'qa-saved-password' : '';
        if (command === 'save_host') {
          const previous = hosts.find((host: any) => host.id === args.host.id);
          const sameIdentity = previous && ['address', 'port', 'username'].every(key => previous[key] === args.host[key]);
          const host = { ...args.host, remoteSystem: sameIdentity ? previous.remoteSystem : null, rememberPassword: Boolean(args.password) || Boolean(previous?.rememberPassword) };
          hosts = [...hosts.filter((h: any) => h.id !== host.id), host];
          localStorage.setItem('qa-hosts', JSON.stringify(hosts));
          return host;
        }
        if (command === 'duplicate_host') {
          const source = hosts.find((host:any) => host.id === args.id);
          const copied = {...source,id:`qa-copy-${++copyCounter}`,name:`${source.name}（副本）`};
          hosts.push(copied); localStorage.setItem('qa-hosts', JSON.stringify(hosts)); return copied;
        }
        if (command === 'list_known_hosts') return knownHosts;
        if (command === 'forget_known_host') { knownHosts = knownHosts.filter(item => !(item.address === args.address && item.port === args.port && item.fingerprint === args.expectedFingerprint)); return; }
        if (command === 'preview_host_import') return w.__qa.importPreview;
        if (command === 'import_hosts') {
          let imported = 0, skipped = 0;
          for (const item of args.hosts) {
            if (hosts.some((host:any) => host.address === item.address && host.port === item.port && host.username === item.username)) skipped++;
            else {hosts.push({...item,rememberPassword:false}); imported++;}
          }
          localStorage.setItem('qa-hosts',JSON.stringify(hosts)); return {imported,skipped};
        }
        if (command === 'export_hosts') return;
        if (command === 'list_local_forwards') return forwards.filter(item => item.sessionId === args.sessionId);
        if (command === 'start_local_forward') { const item = {id:`qa-forward-${forwards.length+1}`,sessionId:args.sessionId,localPort:args.localPort || 12345,remoteHost:args.remoteHost,remotePort:args.remotePort}; forwards.push(item); return item; }
        if (command === 'stop_local_forward') {const index=forwards.findIndex(item => item.id === args.id);if(index>=0)forwards.splice(index,1);return;}
        if (command === 'delete_host') { hosts = hosts.filter((h: any) => h.id !== args.id); localStorage.setItem('qa-hosts', JSON.stringify(hosts)); return; }
        if (command === 'connect_host') {
          const host = hosts.find((host: any) => host.id === args.hostId);
          // This fixture persists credential availability only, never secrets.
          if (args.password) {
            host.rememberPassword = true;
            localStorage.setItem('qa-hosts', JSON.stringify(hosts));
          }
          if (host.authMethod !== 'agent' && !host.rememberPassword) throw { code: host.authMethod === 'privateKey' ? 'key_passphrase_required' : 'password_required', message: '请输入服务器凭据' };
          if (w.__qa.failAuthNext) {
            w.__qa.failAuthNext = false;
            throw { code: 'ssh_auth_failed', message: '服务器密码已失效' };
          }
          const session = { id: `qa-session-${++sessionCounter}`, hostId: args.hostId, hostName: host.name, fingerprint: 'SHA256:qa' };
          sessions.set(session.id, { ...host });
          return session;
        }
        if (command === 'detect_host_system') {
          if (w.__qa.pauseDetection) await new Promise<void>(resolve => { w.__qa.finishDetection = resolve; });
          if (w.__qa.detectFailure) throw { code: 'probe_unavailable', message: '测试服务器不支持检测' };
          const expected = sessions.get(args.sessionId);
          const host = hosts.find((host: any) => host.id === expected?.id);
          if (!host || !['address', 'port', 'username'].every(key => host[key] === expected[key])) return null;
          host.remoteSystem = { id: 'ubuntu', name: 'Ubuntu', version: '24.04' };
          localStorage.setItem('qa-hosts', JSON.stringify(hosts));
          return host.remoteSystem;
        }
        if (command === 'get_home_directory') return '/local';
        if (command === 'resolve_file_path') return args.path === '.' ? '/remote' : args.path;
        if (command === 'list_files') return entries(args.path);
        if (command === 'get_preferences') return { ...preferences };
        if (command === 'list_system_fonts') return ['Hannotate SC', 'Menlo', 'Monaco', 'PingFang SC', 'Courier New', 'Arial'];
        if (command === 'set_preference') { preferences[args.key] = args.value; localStorage.setItem('qa-preferences', JSON.stringify(preferences)); return; }
        if (slowServices && ['get_portable_info', 'get_homebrew_info', 'list_extensions'].includes(command)) {
          await servicesReady;
        }
        if (command === 'get_data_directory') return '/fixture/ssh-go/data';
        if (command === 'get_portable_info') return { root: '/Applications/SSH Tools Portable', platform, architecture: 'aarch64' };
        if (command === 'get_homebrew_info') return { available: true, executable: '/opt/homebrew/bin/brew', prefix: '/opt/homebrew', version: 'Homebrew 7.0.8', architecture: 'aarch64' };
        if (command === 'refresh_homebrew_info') return { available: true, executable: '/opt/homebrew/bin/brew', prefix: '/opt/homebrew', version: 'Homebrew 7.0.8', architecture: 'aarch64' };
        if (command === 'list_extensions') return extensions;
        if (command === 'install_extension') {
          extensions = extensions.map((item: any) => item.id === args.id ? { ...item, installedVersion: item.id === 'caddy' ? '2.11.7' : '1.0.0', serviceStatus: item.serviceName ? 'stopped' : null } : item);
          return extensions.find((item: any) => item.id === args.id);
        }
        if (command === 'uninstall_extension') {
          extensions = extensions.map((item: any) => item.id === args.id ? { ...item, installedVersion: null, serviceStatus: null } : item);
          return;
        }
        if (command === 'upgrade_extension') return { command: `/opt/homebrew/bin/brew upgrade --formula ${args.id}`, output: 'Already up-to-date.', success: true };
        if (command === 'run_homebrew_maintenance') return { command: `/opt/homebrew/bin/brew ${args.action}`, output: 'Homebrew operation completed.', success: true };
        if (command === 'extension_service_action') {
          extensions = extensions.map((item: any) => item.id === args.id ? { ...item, serviceStatus: args.action === 'stop' ? 'stopped' : 'running' } : item);
          return extensions.find((item: any) => item.id === args.id);
        }
        if (command === 'get_resource_snapshot') return { cpuPercent: 0.8, memoryBytes: 32 * 1024 * 1024, processCount: 1, scope: '测试采样' };
        if (command === 'get_server_metrics') {
          if (w.__qa.pauseMonitor) await new Promise<void>(resolve => { w.__qa.finishMonitor = resolve; });
          if (w.__qa.monitorError) throw w.__qa.monitorError;
          const count = w.__qa.calls.filter((c: any) => c.command === command && c.args.sessionId === args.sessionId).length;
          return {
            sampledAt: Date.now(), cpuPercent: count === 1 ? null : 17.6, cpuCores: 4,
            memoryTotal: 8 * 1024 ** 3, memoryUsed: 3 * 1024 ** 3, memoryAvailable: 5 * 1024 ** 3,
            swapTotal: 2 * 1024 ** 3, swapUsed: 128 * 1024 ** 2, uptimeSeconds: 186420,
            load: [0.42, 0.38, 0.31], networkReceiveRate: count === 1 ? null : 2.4 * 1024 ** 2,
            networkTransmitRate: count === 1 ? null : 384 * 1024,
            disks: [{ filesystem: '/dev/sda1', mount: '/', total: 100 * 1024 ** 3, used: 37 * 1024 ** 3, available: 58 * 1024 ** 3, usedPercent: 38.9 },
              { filesystem: '/dev/sdb1', mount: '/data', total: 500 * 1024 ** 3, used: 460 * 1024 ** 3, available: 35 * 1024 ** 3, usedPercent: 92.9 }],
            warnings: [],
          };
        }
        if (command === 'open_terminal') {
          w.__qa.terminal = (text: string) => w.__qa.emit(args.eventName, { kind: 'output', data: [...new TextEncoder().encode(text)] });
          w.__qa.terminal('SSH Tools test terminal\r\n');
          return { id: `qa-terminal-${++terminalCounter}`, sessionId: args.sessionId };
        }
        if (command === 'start_transfer') {
          const request = args.request;
          if (request.sourcePath === w.__qa.failSource) throw { message: '测试文件无法读取' };
          if (transferId >= w.__qa.queueLimit) throw { code: 'transfer_queue_full', message: '传输队列已满' };
          w.__qa.transfer = { id: `qa-transfer-${++transferId}`, name: request.sourcePath.split('/').pop(), direction: request.destination.kind === 'remote' ? 'upload' : 'download', destination: structuredClone(request.destination), sessionIds: [args.request.destination.sessionId || args.request.source.sessionId].filter(Boolean), status: 'running', bytesDone: 16384, bytesTotal: 65536, error: null, sourcePath: request.sourcePath, destinationPath: request.destinationPath };
          w.__qa.emit('transfer-update', w.__qa.transfer);
          return w.__qa.transfer;
        }
        if (command === 'list_transfers') return [];
        if (command === 'list_transfer_recoveries') {
          if(w.__qa.recoveryReadError)throw {code:'recovery_journal_invalid',message:w.__qa.recoveryReadError};
          return w.__qa.recoveries;
        }
        if (command === 'recover_transfer') {
          if(w.__qa.recoveryActionError)throw {code:'recovery_ambiguous',message:w.__qa.recoveryActionError};
          w.__qa.recoveries=w.__qa.recoveries.filter((item:any)=>item.id!==args.id);return;
        }
        if (command === 'cancel_transfer') { w.__qa.transfer.status = 'cancelled'; w.__qa.emit('transfer-update', w.__qa.transfer); return; }
        if (command === 'disconnect_session') { w.__qa.emit('session-closed', { sessionId: args.id, reason: '测试连接关闭' }); return; }
        return null;
      },
    });
  }, { largeDirectory, needsPassword, gallery, platform, slowServices });
}
