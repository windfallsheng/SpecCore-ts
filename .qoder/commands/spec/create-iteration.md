创建迭代: 名称=${1:Q2} 负责人=${2|张三,李四,王五|}

执行命令: `speccore iteration create -n ${1:Q2} --owner=${2|张三,李四,王五|}`