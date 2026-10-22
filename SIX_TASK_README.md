# 六任务版 v23

在 v22 基础上将后台 TASKS 增加 task4/task5/task6；学生端、教师端都使用 API 返回的 tasks 自动绘制，不必硬编码额外按钮。

- 教师后台显示六个任务的独立切换按钮、每名学生的六任务标签。
- 切换到未访问的新任务会初始化该任务的独立 Coze conversationId；切回原任务则使用保存在原 taskId/session.json 的 conversationId 继续聊天，旧图片和消息不删除。
- 原 task1~task3 存储键完全不变，新增 task4~task6 不覆盖旧记录。
- 建议用 S00 验证任务1发图和A/B/C→切任务4新会话→切回任务1历史与后续选项恢复。
- 不要更改项目原 DATA_STORE_NAME、EXPERIMENT_RUN_ID，正式数据上传名单前先备份。
- 注意：未经 EdgeOne/Coze 真实账号的端到端验收，不应认定上线验证通过。
