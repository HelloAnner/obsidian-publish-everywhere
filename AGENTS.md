obsidian 标准插件源码仓库;

功能: 将obsidian内的笔记发布到不同的第三方笔记平台; 

- confluence (别名 kms)
- 飞书

## 发布规则

- 使用笔记的属性作为发布的标识
- 指定父页面位置,自动在父页面下创建子页面 , 以笔记的名称作为判断标识; 如果笔记已经存在, 就替换; 如果笔记不存在 ,就新建
- 更新 xxx_url 属性, 作为本笔记对应的平台的访问url


### kms 发布规则



## obsidian 仓库介绍

笔记位置: /Users/anner/notes/Work/ 

可以使用的skill:
- notes skill : 介绍了obsidian的结构 , 写作风格


## 每一次修改后的验证步骤

1. 执行 make package 