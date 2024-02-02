import { Observable, Subject } from 'rxjs';
import { buffer, concatMap, debounceTime, delay, filter, retry } from 'rxjs/operators';
import * as chokidar from 'chokidar';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

function log(info: string) {
  console.log(`------- ${new Date().toLocaleString()} ${info} -------`);
}

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

/**
 * 命令行参数
 * @param projectPath 项目本地绝对路径。default(`./`)
 * @example --projectPath=F:/projects/cloudapp
 * 
 * @param watchTs 启动tsc自动编译。default(`false`)
 * @example --watchTs
 * 
 * @todo
 * @param manualUpdate TODO: 手动更新，开启后将所有更新推到一个stack，
 * 手动输入`update`后更新并清空stack。default(`false`)
 * @example --manualUpdate
 * 
 * @param autoRestart 自动重启应用。default(`true`)
 * @example --autoRestart
 * 
 * @param skipFirstUpdate 跳过第一次更新，通常用来跳过watchTs造成的编译更新
 * @example --skipFirstUpdate
 * 
 * @param updateDelay 更新延时，延时后没有新修改，会触发更新。default(`5000`)
 * @example --updateDelay=5000
 * 
 * @param delayAfterUpdate 每次更新后暂停时间。default(`5000`)
 * @example --delayAfterUpdate=5000
 * 
 * @param sourcePath 推送的目录，使用`,`分隔。default(`src,res`)
 * @example --sourcePath=src,res
 * 
 * @param appName 应用名，默认取`manifest.json`的`domain.name`
 * @example --appName=myapp.cloudapp.com
 * 
 * @param pageLink 默认取`manifest.json`中的`pages[0].uri`
 * 
 * @param tscFilePath tsc文件绝对路径。default(`C:/.sdk/tools/etsc/tsc.js`)
 * 
 * @param tscWatchExcludeDirectories tsc watch 排除的文件目录，使用`,`分隔。default(`'/node_modules,/src,/.vscode,/res'`)
 */
interface Argv {
  projectPath?: string;
  watchTs?: boolean;
  manualUpdate?: boolean;
  autoRestart?: boolean;
  skipFirstUpdate?: boolean;
  updateDelay?: number;
  delayAfterUpdate?: number;
  sourcePath?: string;
  appName?: string;
  pageLink?: string;
  tscFilePath?: string;
  tscWatchExcludeDirectories?: string;
}

type RequiredArgv = Required<Argv>;

type RequiredArgvKey = keyof RequiredArgv;

type FileChangeEventName = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';

interface FileChange {
  eventName: FileChangeEventName,
  path: string,
}

log('init');

// 命令行参数
const argvFromInput: Argv = require('minimist')(process.argv.slice(2));

// 项目本地路径
let projectPath: string;
if (argvFromInput.projectPath) {
  projectPath = path.resolve(argvFromInput.projectPath);
} else {
  projectPath = path.resolve('./');
}

log(`reading config from: ${projectPath}/manifest.json`);

// 读取项目的manifest
const manifest = JSON.parse(fs.readFileSync(`${projectPath}/manifest.json`).toString());

// 默认配置
const defaultArgv: RequiredArgv = {
  autoRestart: true,
  skipFirstUpdate: false,
  watchTs: true,
  tscFilePath: 'C:/.sdk/tools/etsc/tsc.js',
  sourcePath: '/src,/res',
  manualUpdate: false,
  projectPath,
  appName: manifest.domain.name,
  pageLink: manifest.pages[0].uri,
  tscWatchExcludeDirectories: '/node_modules,/src,/.vscode,/res',
  updateDelay: 5000,
  delayAfterUpdate: 5000,
};
const tranArgv: Argv = { ...argvFromInput };
(Object.keys(argvFromInput) as RequiredArgvKey[]).forEach((k) => {
  if (typeof defaultArgv[k] === 'boolean') {
    (tranArgv[k] as boolean) = argvFromInput[k] !== 'false';
  }
});
const argv: RequiredArgv = {
  ...defaultArgv,
  ...tranArgv,
}

log(`the final argv: ${JSON.stringify(argv, null, '\t')}`);

// 长延时
const DEFAULT_LONG_DELAY = 99999999999;

// 项目车机路径
const targetPath = `/opt/app/${argv.appName}`;

// 监听静态文件路径
const relativeSourcePath = argv.sourcePath.split(',');

// 静态文件绝对路径
const sourcePath = relativeSourcePath.map((v) => path.resolve(projectPath, './' + v));


let updateSubject;

if (argv.manualUpdate) {
  updateSubject = new Subject<boolean>();
  // TODO:
}

// 初始化日志 adb -host shell 'logctl -p 3 && apr off'
exec(`adb -host shell logctl -p 3 && adb -host shell apr off`, (err) => {
  if (err) {
    console.error(err);
  } else {
    log('Log preference initialized!');
  }
});

// 清除编译后文件
exec(`adb -host shell "cd /opt/app/${argv.appName} && rm -rf ${argv.appName}.jso jso_file.list && cd res && rm -rf static_compile_list.json offline_compile_theme_list.json ./default/layout/layout.json.js && find . -name *.xml.js | xargs rm -rf && find . -name *.json.js | xargs rm -rf && find . -name *.js.uglifymap | xargs rm -rf && rm res/default/theme/statictheme.js"`, (err) => {
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

  const excludeDirectories = argv.tscWatchExcludeDirectories.split(',');

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

  const tscCommand = `node ${argv.tscFilePath} -ta --sourcemap -p ${newTsconfigPath} --watch`;

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
  log(`watching: ${sourcePath}`);
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

function executeUpdateFiles(changes: FileChange[]): Observable<string> {
  return new Observable((sub) => {
    // 临时生成的bat文件路径
    const batFilePath = './temp.bat';

    const commands = changes.map((v) => {
      // 本地相对路径
      const localPath = v.path.replace(projectPath, '');
      // 车机端相对路径
      let remotePath = localPath.replace(/\\/g, '/');

      let newCommand: string;

      switch (v.eventName) {
        case 'change': {
          newCommand = `adb -host shell rm -f ${targetPath}${remotePath} && adb -host push ${v.path} ${targetPath}${remotePath}`;
          break;
        }
        case 'add': {
          newCommand = `adb -host push ${v.path} ${targetPath}${remotePath}`;
          break;
        }
        case 'addDir': {
          newCommand = `adb -host shell cd ${targetPath} && adb -host shell mkdir ${remotePath.replace(/\\/, '')}`;
          break;
        }
        case 'unlink': {
          newCommand = `adb -host shell rm -f ${targetPath}${remotePath}`;
          break;
        }
        case 'unlinkDir': {
          newCommand = `adb -host shell rm -rf ${targetPath}${remotePath}`;
          break;
        }
        default: {
          newCommand = '';
          break;
        }
      }

      return `${newCommand}\r\n`;
    });

    log('updating');

    // 判断batFilePath是否存在，存在则删除
    if (fs.existsSync(batFilePath)) {
      fs.unlinkSync(batFilePath);
    }



    if (argv.autoRestart) {
      commands.push(`adb -host shell pkill -f ${argv.appName} && adb -host shell sendlink ${argv.pageLink}`);
    }
    fs.appendFileSync(batFilePath, commands.join(''));

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
  buffer(
    fileChangeSubject.pipe(debounceTime(argv.manualUpdate ? DEFAULT_LONG_DELAY : argv.updateDelay))
  ),
  filter((_, idx) => {
    if (argv.skipFirstUpdate && idx < 1) {
      log(`skipped the first update`);
      return false;
    }
    return true;
  }),
  concatMap((changes) => executeUpdateFiles(changes).pipe(
    delay(argv.delayAfterUpdate),
    retry(),
  )),
).subscribe((v) => {
  log(`finished: ${v}`);
});
