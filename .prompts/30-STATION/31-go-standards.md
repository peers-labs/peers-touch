# Golang 官方格式化规范细则（项目统一标准）

本规范以 Go 官方风格为准绳，依据 Effective Go 与 Go Code Review Comments，结合 `gofmt` 的实际输出规则，给出可执行的格式化细则与示例。

## 依据与优先级

- 最终裁判：`gofmt` 输出（任何与本规范冲突处以 `gofmt` 为准）
- 导入管理：`goimports` 自动增删与排序
- 参考文献：Effective Go、Go Code Review Comments、Go Wiki/Style

## 缩进与空白

- 缩进使用 Tab（由 `gofmt` 控制，不用空格替代）
- 每个逻辑段之间使用 1 个空行分隔（函数内的小节、import 分组等）
- 不保留尾随空格；不对齐等号/字段（`gofmt` 不做对齐）

## 花括号与控制流

- 左括号与关键字同行，右括号独占一行：

```
func f() {
	...
}
```

- `if`/`for`/`switch` 的右括号与 `else`/`else if` 同行：

```
if cond {
	...
} else if other {
	...
} else {
	...
}
```

- `switch` 默认无 `break`；必要时用显式 `fallthrough`

## 行宽与换行

- 不强制最大行宽；建议软限制 100–120 列，超过按以下规则换行
- 二元运算在运算符前断行：

```
result := a + b + c +
	longExpression()
```

- 函数调用参数过长时按元素一行，右括号独占行：

```
out := do(
	arg1,
	arg2,
	veryLongArg,
)
```

- 方法链/Builder 一步一行：

```
req := client.
	WithHeader("K", "V").
	WithTimeout(5 * time.Second).
	Do(ctx)
```

- 字符串拼接在 `+` 前断行，优先使用格式化函数：

```
s := "prefix" +
	longPart
```

## 复合字面量与尾逗号

- 多行复合字面量的每个元素独占一行，并保留尾逗号；右括号独占行：

```
list := []string{
	"a",
	"b",
}

m := map[string]int{
	"a": 1,
	"b": 2,
}

s := struct{
	A int
	B string
}{
	A: 1,
	B: "x",
}
```

## import 组织

- 三组，空行分隔：
  - 标准库
  - 第三方依赖（外部模块）
  - 内部包（当前模块内路径）
- 每组内字典序；`goimports` 自动维护
- 仅在名称冲突或缩短长路径时使用显式别名

```
import (
	"context"
	"fmt"
	"time"

	"github.com/lib/pq"
	"golang.org/x/sync/errgroup"

	"your/module/pkg/a"
	"your/module/pkg/b"
)
```

## 命名约定

- 导出标识符使用 UpperCamelCase：`Client`, `DoRequest`
- 未导出使用 lowerCamelCase：`client`, `doRequest`
- 接收者名短小、稳定，通常为类型首字母：`func (c *Client) Do() {}`
- 缩略词使用 Go 惯例大小写：`HTTPServer`, `URL`, `ServeHTTP`
- 避免 `ALL_CAPS` 常量；使用驼峰：`DefaultTimeout`

## 注释与文档

- 包与导出符号的注释以名称开头、完整句子：

```go
// Client 表示网络客户端，提供连接与请求能力。
type Client struct { ... }
```

- 使用 `//` 行注释，避免块注释；文件头生成或版权信息除外
- TODO 规范：`// TODO(name): reason`
- 建议为公共包提供 `doc.go` 概述

## 错误处理与返回

- 采用“早返回”模式：

```go
v, err := parse()
if err != nil {
	return err
}
```

- 包装错误优先使用 `%w`：`fmt.Errorf("open: %w", err)`
- 不与 `panic` 混用；仅在不可恢复的编程错误使用 `panic`

## 布尔与比较

- 避免 `if x == true`/`if x == false`；直接使用布尔值
- 字符串/切片长度比较使用 `len(s) == 0` 而非 `s == ""`（按语义选择）

## 文件与包布局

- 文件名使用小写与下划线分隔：`client.go`, `client_test.go`
- 每包入口处尽量避免复杂 `init()`；初始化通过显式函数完成
- 逻辑分组声明（如 `var (...)`、`const (...)`）由 `gofmt` 统一风格

## 函数体结构与空行（项目规则）

- 禁止将函数体压缩为单行 `func ... { return ... }`
- 每个逻辑处理块之间插入 1 个空行；最终 `return` 之前插入 1 个空行（若函数仅含单一语句除外）
- 示例：

```
// 不允许
func (s *Session) IsExpired() bool { return time.Now().After(s.ExpiresAt) }

// 允许
func (s *Session) IsExpired() bool {
	now := time.Now()

	return now.After(s.ExpiresAt)
}
```

- 说明：`gofmt` 不会自动插入空行，请在编码时遵循本规则；预提交钩子会拒绝单行 `return` 函数体

## 函数间空行与导出注释（项目规则）

- 函数之间必须有 1 个空行：上一个函数的 `}` 与下一个函数（或其文档注释）的首行之间至少留一行空白
- 所有导出函数/方法必须有标准文档注释，且：
  - 注释以标识符名称开头（如：`// IsExpired ...`）
  - 语句完整、可读，描述行为与语义
  - 注释应紧邻函数声明上方，不插入额外空行
  - 方法注释用方法名（非接收者名）开头，例如：`// Touch updates LastSeen to now.`

## 接口与实现

- 倾向于小接口（2–3 个方法）；以使用方为中心设计
- 命名遵循语义：行为接口以 `er` 结尾（如 `Reader`、`Writer`）

## 测试与示例

- 测试文件以 `_test.go` 结尾；示例使用 `ExampleXxx` 并可作为文档片段
- 表驱动测试按用例一行，长输入时分行；保留尾逗号

```
func TestDo(t *testing.T) {
	cases := []struct{
		in  string
		out string
	}{
		{"a", "A"},
		{"b", "B"},
	}
	...
}
```

## 生成代码与指令

- 使用 `//go:generate` 近邻放置在相关类型或包处，命令简洁可复现

## 一致性原则

- 当本规范与既有代码存在差异时，以 `gofmt` 输出与本规范共同指引进行最小改动
- 在同一包内保持一致；跨包遵循通用规则

## 例外与裁决

- 为可读性进行局部调整（如短链保持一行）是允许的，前提是不违背 `gofmt`
- 最终以 `gofmt` 的格式化结果为裁决；任何手工对齐或特殊排版不被接受
