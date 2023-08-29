import { Observable, Subject } from 'rxjs';
import { buffer, concatMap, debounceTime, retry } from 'rxjs/operators';
import * as chokidar from 'chokidar';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

/**
 * 命令行参数
 * @param projectPath 项目本地绝对路径，默认使用'./'
 * @example --projectPath=F:/projects/cloudapp
 * 
 * @param watchTs 启动tsc自动编译，默认false
 * @example --watchTs
 * 
 * @param sourcePath 推送的目录，使用','分隔，默认'src,res'
 * @example --sourcePath=src,res
 * 
 * @param appName 应用名，默认取manifest.json的domain.name
 * @example --appName=myapp.cloudapp.com
 * 
 * @param pageLink 默认取manifest.json中的pages[0].uri
 * 
 * @param tscFilePath tsc文件绝对路径，默认为C:/.sdk/tools/etsc/tsc.js
 * 
 * @param tscWatchExcludeDirectories tsc watch 排除的文件目录，使用','分隔。默认使用['/node_modules', '/src', '/.vscode', '/res']
 */
interface Argv {
  projectPath?: string;
  watchTs?: boolean;
  sourcePath?: string;
  appName?: string;
  pageLink?: string;
  tscFilePath?: string;
  tscWatchExcludeDirectories?: string;
}

type FileChangeEventName = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';

interface FileChange {
  eventName: FileChangeEventName,
  path: string,
}

// 命令行参数
const argv: Argv = require('minimist')(process.argv.slice(2));

console.log(`------- ${new Date().toLocaleString()} init -------`);

// 延时后没有新修改，会触发更新
const DEFAULT_DELAY = 5000;

// 项目本地路径
let projectPath: string;
if (argv.projectPath) {
  projectPath = path.resolve(argv.projectPath);
} else {
  projectPath = path.resolve('./');
}

console.log(`------- ${new Date().toLocaleString()} reading config from: ${projectPath}/manifest.json -------`);

// 读取项目的manifest
const manifest = JSON.parse(fs.readFileSync(`${projectPath}/manifest.json`).toString());
const appName = argv.appName || manifest.domain.name;
const pageLink = argv.pageLink || manifest.pages[0].uri;

// 项目车机路径
const targetPath = `/opt/app/${appName}`;

// 获取监听静态文件路径
let relativeSourcePath: string[];
if (argv.sourcePath) {
  relativeSourcePath = argv.sourcePath.split(',');
} else {
  relativeSourcePath = ['/src', '/res'];
}
// 静态文件绝对路径
const sourcePath = relativeSourcePath.map((v) => path.resolve(projectPath, './' + v));

// tsc文件绝对路径
const tscFilePath = argv.tscFilePath || 'C:/.sdk/tools/etsc/tsc.js';

// 初始化日志 adb -host shell 'logctl -p 3 && apr off'
exec(`adb -host shell logctl -p 3 && adb -host shell apr off`, (err) => {
  if (err) {
    console.error(err);
  } else {
    log('Log preference initialized!');
  }
});

// 清除编译后文件
exec(`adb -host shell "cd /opt/app/${appName} && rm -rf ${appName}.jso jso_file.list && cd res && rm -rf static_compile_list.json offline_compile_theme_list.json"`, (err) => {
  if (err) {
    console.error(err);
  } else {
    log('Jso files cleared!');
  }
});

// 启动tsc自动编译
if (argv.watchTs) {
  // 新tsconfig配置路径
  const newTsconfigPath = projectPath + '/newTsconfig.json';

  let excludeDirectories = ['/node_modules', '/src', '/.vscode', '/res'];

  if (argv.tscWatchExcludeDirectories) {
    excludeDirectories = argv.tscWatchExcludeDirectories.split(',');
  }

  // 添加watchOptions到新的tsconfig
  const watchOptions = {
    watchFile: 'useFsEvents',
    watchDirectory: 'useFsEvents',
    fallbackPolling: 'dynamicPriority',
    synchronousWatchDirectory: true,
    excludeDirectories,
    excludeFiles: [],
  };
  const tsconfig = JSON.parse(fs.readFileSync(`${projectPath}/tsconfig.json`).toString());
  tsconfig['watchOptions'] = watchOptions;

  const tscCommand = `node ${tscFilePath} -ta --sourcemap -p ${newTsconfigPath} --watch`;

  fs.writeFileSync(newTsconfigPath, JSON.stringify(tsconfig, null, '\t'));

  exec(tscCommand, (err) => {
    if (err) {
      console.error(err);
    }
  });
}

const watcher = chokidar.watch(sourcePath, { ignoreInitial: true });
const fileChangeSubject = new Subject<FileChange>();

watcher.on('ready', () => {
  console.log(`------- ${new Date().toLocaleString()} watching: ${sourcePath} -------`);
});

watcher.on('all', (eventName, path, stats?) => {
  console.log(eventName, ' path: ', path);
  if (path.includes(projectPath.replace(/\//g, '\\'))) {
    fileChangeSubject.next({
      eventName,
      path,
    });
  }
});

/**
 * 命令行输入
 * @param {string} tips 
 * @returns {promise}
 * @example 多次输入
 * function readSyncByRlFun() {
 *  readSyncByRl().then((v: string) => {
 *     readSyncByRlFun();
 *   });
 * }
 * readSyncByRlFun();
 */
function readSyncByRl(tips = '>'): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(tips, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function executeUpdateFiles(changes: FileChange[]): Observable<string> {
  return new Observable((sub) => {
    // 临时生成的bat文件路径
    const batFilePath = './temp.bat';

    const commands = changes.map((v) => {
      // 本地相对路径
      const localPath = v.path.replace(projectPath, '');
      // 车机端相对路径
      const remotePath = localPath.replace(/\\/g, '/');

      switch (v.eventName) {
        case 'change': {
          const command = `adb -host shell rm -f ${targetPath}${remotePath} && adb -host push ${v.path} ${targetPath}${remotePath}`;
          return command;
        }
        case 'add': {
          const command = `adb -host push ${v.path} ${targetPath}${remotePath}`;
          return command;
        }
        case 'addDir': {
          const command = `adb -host shell cd ${targetPath} && adb -host shell mkdir ${remotePath.replace(/\\/, '')}`;
          return command;
        }
        case 'unlink': {
          const command = `adb -host shell rm -f ${targetPath}${remotePath}`;
          return command;
        }
        case 'unlinkDir': {
          const command = `adb -host shell rm -rf ${targetPath}${remotePath}`;
          return command;
        }
        default: {
          return '';
        }
      }
    });

    console.log(`--------- ${new Date().toLocaleString()} updating ---------`);

    // 判断batFilePath是否存在，存在则删除
    if (fs.existsSync(batFilePath)) {
      fs.unlinkSync(batFilePath);
    }

    commands.forEach((cmd) => {
      fs.appendFileSync(batFilePath, `${cmd}\r\n`);
    });

    fs.appendFileSync(batFilePath, `adb -host shell pkill -f ${appName} && adb -host shell sendlink ${pageLink}`);

    exec(`"${batFilePath}"`, (e, stdout, stderr) => {
      fs.unlinkSync(batFilePath);
      if (e) {
        console.error(`exec failed: ${batFilePath}`, e);
        // 更新失败手动确认重试
        readSyncByRl('Update failed, retry? (Y/N)').then((inp) => {
          const lc = inp.toLowerCase();
          if (lc === 'y') {
            sub.error(e);
          } else {
            sub.next('failed');
            sub.complete();
          }
        });
      } else {
        sub.next('success');
        sub.complete();
      }
    });
  });
}

// 延时后没有新修改，推入队列，触发更新
fileChangeSubject.pipe(
  buffer(fileChangeSubject.pipe(debounceTime(DEFAULT_DELAY))),
  concatMap((changes) => executeUpdateFiles(changes).pipe(retry())),
).subscribe((v) => {
  console.log(`--------- ${new Date().toLocaleString()} finished: ${v} ---------`);
});
