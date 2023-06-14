"use strict";
exports.__esModule = true;
var rxjs_1 = require("rxjs");
var operators_1 = require("rxjs/operators");
var chokidar = require("chokidar");
var child_process_1 = require("child_process");
var fs = require("fs");
var path = require("path");
// 命令行参数
var argv = require('minimist')(process.argv.slice(2));
console.log("------- ".concat(new Date().toLocaleString(), " init -------"));
// 延时后没有新修改，会触发更新
var DEFAULT_DELAY = 5000;
// 项目本地路径
var projectPath;
if (argv.projectPath) {
    projectPath = path.resolve(argv.projectPath);
}
else {
    projectPath = path.resolve('./');
}
console.log("------- ".concat(new Date().toLocaleString(), " reading config from: ").concat(projectPath, "/manifest.json -------"));
// 读取项目的manifest
var manifest = JSON.parse(fs.readFileSync("".concat(projectPath, "/manifest.json")).toString());
var appName = argv.appName || manifest.domain.name;
var pageLink = argv.pageLink || manifest.pages[0].uri;
// 项目车机路径
var targetPath = "/opt/app/".concat(appName);
// 获取监听静态文件路径
var relativeSourcePath;
if (argv.sourcePath) {
    relativeSourcePath = argv.sourcePath.split(',');
}
else {
    relativeSourcePath = ['/src', '/res'];
}
// 静态文件绝对路径
var sourcePath = relativeSourcePath.map(function (v) { return path.resolve(projectPath, './' + v); });
// tsc文件绝对路径
var tscFilePath = argv.tscFilePath || 'C:/.sdk/tools/etsc/tsc.js';
// 初始化日志
(0, child_process_1.exec)("adb -host shell logctl -p 3 && adb -host shell apr off");
// 启动tsc自动编译
if (argv.watchTs) {
    // 新tsconfig配置路径
    var newTsconfigPath = projectPath + '/newTsconfig.json';
    var excludeDirectories = ['/node_modules', '/src', '/.vscode', '/res'];
    if (argv.tscWatchExcludeDirectories) {
        excludeDirectories = argv.tscWatchExcludeDirectories.split(',');
    }
    // 添加watchOptions到新的tsconfig
    var watchOptions = {
        watchFile: 'useFsEvents',
        watchDirectory: 'useFsEvents',
        fallbackPolling: 'dynamicPriority',
        synchronousWatchDirectory: true,
        excludeDirectories: excludeDirectories,
        excludeFiles: []
    };
    var tsconfig = JSON.parse(fs.readFileSync("".concat(projectPath, "/tsconfig.json")).toString());
    tsconfig['watchOptions'] = watchOptions;
    var tscCommand = "node ".concat(tscFilePath, " -ta --sourcemap -p ").concat(newTsconfigPath, " --watch");
    fs.writeFileSync(newTsconfigPath, JSON.stringify(tsconfig, null, '\t'));
    (0, child_process_1.exec)(tscCommand);
}
var watcher = chokidar.watch(sourcePath, { ignoreInitial: true });
var fileChangeSubject = new rxjs_1.Subject();
watcher.on('ready', function () {
    console.log("------- ".concat(new Date().toLocaleString(), " watching: ").concat(sourcePath, " -------"));
});
watcher.on('all', function (eventName, path, stats) {
    console.log(eventName, ' path: ', path);
    if (path.includes(projectPath.replace(/\//g, '\\'))) {
        fileChangeSubject.next({
            eventName: eventName,
            path: path
        });
    }
});
function executeUpdateFiles(changes) {
    return new rxjs_1.Observable(function (sub) {
        // 临时生成的bat文件路径
        var batFilePath = './temp.bat';
        var commands = changes.map(function (v) {
            // 本地相对路径
            var localPath = v.path.replace(projectPath, '');
            // 车机端相对路径
            var remotePath = localPath.replace(/\\/g, '/');
            switch (v.eventName) {
                case 'change': {
                    var command = "adb -host shell rm -f ".concat(targetPath).concat(remotePath, " && adb -host push ").concat(v.path, " ").concat(targetPath).concat(remotePath);
                    return command;
                }
                case 'add': {
                    var command = "adb -host push ".concat(v.path, " ").concat(targetPath).concat(remotePath);
                    return command;
                }
                case 'addDir': {
                    var command = "adb -host shell cd ".concat(targetPath, " && adb -host shell mkdir ").concat(remotePath.replace(/\\/, ''));
                    return command;
                }
                case 'unlink': {
                    var command = "adb -host shell rm -f ".concat(targetPath).concat(remotePath);
                    return command;
                }
                case 'unlinkDir': {
                    var command = "adb -host shell rm -rf ".concat(targetPath).concat(remotePath);
                    return command;
                }
                default: {
                    return '';
                }
            }
        });
        console.log("--------- ".concat(new Date().toLocaleString(), " updating ---------"));
        // 判断batFilePath是否存在，存在则删除
        if (fs.existsSync(batFilePath)) {
            fs.unlinkSync(batFilePath);
        }
        commands.forEach(function (cmd) {
            fs.appendFileSync(batFilePath, "".concat(cmd, "\r\n"));
        });
        fs.appendFileSync(batFilePath, "adb -host shell pkill -f ".concat(appName, " && adb -host shell sendlink ").concat(pageLink));
        (0, child_process_1.exec)("\"".concat(batFilePath, "\""), function (e, stdout, stderr) {
            fs.unlinkSync(batFilePath);
            if (e) {
                console.error(e);
                sub.next('error');
            }
            else {
                sub.next('success');
            }
            sub.complete();
        });
    });
}
// 延时后没有新修改，推入队列，触发更新
fileChangeSubject.pipe((0, operators_1.buffer)(fileChangeSubject.pipe((0, operators_1.debounceTime)(DEFAULT_DELAY))), (0, operators_1.concatMap)(executeUpdateFiles)).subscribe(function (v) {
    console.log("--------- ".concat(new Date().toLocaleString(), " finished: ").concat(v, " ---------"));
});
