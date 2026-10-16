/* =========================================================
   题库数据层（演示用样本）
   ---------------------------------------------------------
   正式版会由脚本把 题库/*.md 解析成同样的结构。
   这里内联少量真实题目 + 少量补充题，覆盖全部题型。
   统一结构：
     Bank   { id, name, desc, icon, chapters[] }
     Chapter{ id, name, questions[] }
     Question {
       id, type: 'single'|'multiple'|'judge'|'fill',
       stem,            // 题干，支持 `行内代码`
       options?,        // 选择题的选项文本数组；判断题固定为 ['正确','错误']
       answer,          // 统一为字母数组；填空题为可接受答案的字符串数组
       analysis?,       // 解析
       legacyAnswer?    // 原始题库里的脏答案（演示容错处理）
     }
   ========================================================= */
window.BANKS = [
  {
    id: 'web',
    name: 'Web 前端题库',
    desc: 'HTML / CSS / JavaScript 基础与进阶',
    icon: '🌐',
    chapters: [
      {
        id: 'web-html', name: '一、HTML 基础',
        questions: [
          {
            id: 'web-html-1', type: 'single',
            stem: '下面选项中，用于为页面添加视频的标签是（　）。',
            options: ['audio', 'video', 'text', 'image'], answer: ['B'],
            analysis: 'HTML5 中 `<video>` 用于嵌入视频，`<audio>` 用于音频。'
          },
          {
            id: 'web-html-2', type: 'judge',
            stem: '在 HTML 中，form 标签可以实现用户信息的收集和传递。',
            options: ['正确', '错误'], answer: ['A'],
            analysis: 'form 是表单容器，负责收集并提交用户输入的数据。'
          },
          {
            id: 'web-html-3', type: 'multiple',
            stem: '以下哪些标签默认是块级元素（block）？',
            options: ['<div>', '<span>', '<p>', '<a>'], answer: ['A', 'C'],
            analysis: '`<div>` 与 `<p>` 默认为块级；`<span>`、`<a>` 默认为行内元素。'
          },
          {
            id: 'web-html-4', type: 'fill',
            stem: 'HTML 中用于产生超链接的标签名是哪一个？（只写标签名，不含尖括号）',
            answer: ['a'], analysis: '超链接使用 `<a>` 标签，配合 href 属性指定目标地址。'
          }
        ]
      },
      {
        id: 'web-css', name: '二、CSS',
        questions: [
          {
            id: 'web-css-1', type: 'single',
            stem: '下列选项中，用来设置一行内容的垂直对齐方式的是（　）。',
            options: ['height', 'align', 'valign', 'background'], answer: ['C'],
            analysis: 'valign 用于设置单元格内容的垂直对齐，可选 top / middle / bottom。'
          },
          {
            id: 'web-css-2', type: 'fill',
            stem: '把元素设置为弹性布局，`display` 属性应取的值是？',
            answer: ['flex'], analysis: '`display: flex` 开启弹性盒布局。'
          },
          {
            id: 'web-css-3', type: 'judge',
            stem: 'CSS 中，`margin` 与 `padding` 都可以取负值。',
            options: ['正确', '错误'], answer: ['B'],
            analysis: '`margin` 可取负值，`padding` 不允许为负。'
          },
          {
            id: 'web-css-4', type: 'multiple',
            stem: '以下哪些属于 CSS 的选择器？',
            options: ['标签选择器', '类选择器', 'ID 选择器', '编译选择器'], answer: ['A', 'B', 'C'],
            analysis: '常见选择器有标签、类、ID、属性、伪类等，没有"编译选择器"。'
          }
        ]
      },
      {
        id: 'web-js', name: '三、JavaScript 基础',
        questions: [
          {
            id: 'web-js-1', type: 'single',
            stem: '用于声明块级作用域变量的关键字是（　）。',
            options: ['var', 'let', 'function', 'class'], answer: ['B'],
            analysis: '`let` / `const` 声明块级作用域变量，`var` 是函数作用域。'
          },
          {
            id: 'web-js-2', type: 'multiple',
            stem: '以下哪些属于 JavaScript 的基本数据类型？',
            options: ['String', 'Number', 'Array', 'Boolean'], answer: ['A', 'B', 'D'],
            analysis: 'Array 是对象（引用类型），不是基本数据类型。'
          },
          {
            id: 'web-js-3', type: 'fill',
            stem: '`typeof null` 返回的字符串是？',
            answer: ['object'], analysis: '这是 JS 的历史遗留问题，`typeof null === "object"`。'
          },
          {
            id: 'web-js-4', type: 'judge',
            stem: '`typeof null` 的结果是 "object"。',
            options: ['正确', '错误'], answer: ['A'],
            analysis: '属于语言早期设计缺陷，被保留至今。'
          },
          {
            /* 复刻真题库中的脏数据：答案写成了不存在的 E，选项只有 A~D */
            id: 'web-js-5', type: 'single',
            stem: '在 JavaScript 中，用于向数组开头添加元素的正确方法是（　）。',
            options: ['push()', 'unshift()', 'pop()', 'shift()'],
            answer: [],
            legacyAnswer: 'E',
            analysis: '正确答案应为 B（unshift，向数组开头添加）；原始题库此处标为 E，属于脏数据。'
          }
        ]
      }
    ]
  },
  {
    id: 'java',
    name: 'Java 程序设计题库',
    desc: '语法基础与面向对象',
    icon: '☕',
    chapters: [
      {
        id: 'java-base', name: '一、Java 基础',
        questions: [
          {
            id: 'java-base-1', type: 'single',
            stem: '安装 Java 开发环境时，需要配置的环境变量是（　）。',
            options: ['PATH 和 CLASSPATH', 'JAVA_HOME 和 PATH',
                      'JAVA_HOME 和 CLASSPATH', 'JRE_HOME 和 CLASSPATH'],
            answer: ['B'],
            analysis: 'JAVA_HOME 指向 JDK 目录，PATH 加入 bin 后才能直接用 java/javac。'
          },
          {
            id: 'java-base-2', type: 'single',
            stem: '已知 `String str = "Java";`，则 `str.charAt(1)` 的结果是（　）。',
            options: ["'J'", "'a'", "'v'", '""'], answer: ['B'],
            analysis: '索引从 0 开始，charAt(1) 取到第 2 个字符 "a"。'
          },
          {
            id: 'java-base-3', type: 'multiple',
            stem: '以下哪些是 Java 的合法标识符？',
            options: ['_name', '2count', 'userName', 'class'], answer: ['A', 'C'],
            analysis: '标识符不能以数字开头，也不能是关键字（如 class）。'
          },
          {
            id: 'java-base-4', type: 'judge',
            stem: 'Java 中，`==` 比较字符串时比较的是内容而不是地址。',
            options: ['正确', '错误'], answer: ['B'],
            analysis: '`==` 比较引用地址，比较内容要用 `equals()`。'
          },
          {
            id: 'java-base-5', type: 'fill',
            stem: 'Java 中用于定义常量的关键字是？',
            answer: ['final'], analysis: '`final` 修饰的变量只能赋值一次。'
          }
        ]
      },
      {
        id: 'java-oop', name: '二、面向对象',
        questions: [
          {
            id: 'java-oop-1', type: 'single',
            stem: '当子类方法与父类方法名称、参数列表、返回类型都相同时，这种情况称为（　）。',
            options: ['方法重载', '方法重写', '继承', '多态'], answer: ['B'],
            analysis: '重写（Override）覆盖父类方法；重载（Overload）要求参数列表不同。'
          },
          {
            id: 'java-oop-2', type: 'multiple',
            stem: '以下关于 `super` 关键字的说法，正确的有？',
            options: ['可以调用父类构造方法', '可以调用父类成员方法',
                      '可以调用父类成员变量', '可以调用本类构造方法'],
            answer: ['A', 'B', 'C'],
            analysis: '调用本类构造方法要用 `this(...)`，不能用 super。'
          },
          {
            id: 'java-oop-3', type: 'judge',
            stem: '一个类没有显式定义构造方法时，Java 会自动提供一个无参构造方法。',
            options: ['正确', '错误'], answer: ['A'],
            analysis: '编译器自动补一个空的无参构造方法。'
          },
          {
            id: 'java-oop-4', type: 'fill',
            stem: 'Java 中所有类的直接或间接父类是哪个类？（写类名）',
            answer: ['object', 'Object'], analysis: '`java.lang.Object` 是所有类的根父类。'
          }
        ]
      }
    ]
  }
];
