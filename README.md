# fileWatcherForAliOSMagicCode AliOSMagicCode的文件监听器并改进功能
## 改进Magic Code Capability的watch功能
Magic Code Capability自带的[watch](https://developers.alios.cn/reader/6/4133?refer=search)不是很好用，包括改动后会全局重新编译(甚至只是md的改动)、多次改动导致重复编译大量消耗cpu等

### 和自带的watch相比：
1. 使用了tsc --watch增量编译，而不是全编
2. 使用了同步队列，上一次推送完成后，再进行下一次任务，减少文件混乱风险
3. 可配置监听目录
4. 纯js项目也能用
5. 推送失败会暂停并询问是否继续推送

### 典型流程：启动监听 => 文件修改 => 触发编译(可选) => 收到src等文件变化 => 等待5s => 进入队列 => 推送文件 => 重启应用 => 完成

### 注意：
1. 首次使用或车机、电脑文件不同步时，需要先run app或全推文件到车机
2. 启动tsc --watch自动编译时，会立即触发一些文件的修改事件

### 使用方法：
1. clone项目
2. 根据项目添加script，例如
```js
"watch:myTsApp": "tsc ./watchFile.ts & node ./watchFile.js --projectPath=F:/projects/myTsApp --watchTs --sourcePath=src,res"
```
3. npm run watch:myTsApp
4. 完整配置如下
```js
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
```
### 可配合[Auto Run Command](https://github.com/GabiGrin/vscode-auto-run-command)插件，跟随vscode自启动：
1. 修改vscode settings.json，添加hasFile指定项目的特征文件
```json
  // settings.json
  "auto-run-command.rules": [
    {
      "condition":  [
        "hasFile: XXX.XX"
      ],
      "command": "F:\\projects\\runWatch.bat",
      "message": "runWatch",
      "shellCommand": true
    }
  ]
```
2. 创建runWatch.bat
```bat
// runWatch.bat
start cmd /k "cd /d F:\projects\fileWatcherForAliOSMagicCode && npm run watch:myTsApp"
```
3. 这样每次用vscode打开项目就会自动watch
