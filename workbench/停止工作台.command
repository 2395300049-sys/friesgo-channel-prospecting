#!/bin/zsh
cd -- "${0:A:h}"
node ./local/dist/launcher.mjs stop "$@"
if [ $? -ne 0 ]; then
  echo "请确认已安装 Node.js 24 并完成 npm ci 和 npm run build。按回车关闭。"
  read
fi
