(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.comparisonModel = factory();
})(typeof window === "undefined" ? globalThis : window, () => ({
  create(sites) {
    return {
      id: "",
      title: "新的 AI 对比",
      prompt: "",
      taskId: "",
      sites: sites
        .slice(0, 2)
        .map((s) => ({ ...s, status: "pending", width: 1 })),
      active: sites[0]?.id || "",
      history: [],
      answers: [],
      common: "",
      conflicts: "",
      notes: "",
      deleted: false,
    };
  },
  markdown(c) {
    const answers = c.answers.filter((a) => !a.deleted),
      line = (s) => String(s).replace(/\r/g, "");
    const list = (flag) =>
      answers
        .filter((a) => a[flag])
        .map(
          (a) =>
            `- ${a.siteName}：${a.title}（见第 ${answers.indexOf(a) + 1} 条回答）`,
        )
        .join("\n\n") || "（未标记）";
    return (
      `# ${line(c.title)}\n\n## 原始问题\n\n${line(c.prompt)}\n\n## 参与的 AI\n\n${c.sites.map((s) => s.name).join("、")}\n\n## AI 回答\n\n` +
      answers
        .map(
          (a) =>
            `### ${line(a.siteName)} · ${line(a.title)}\n\n${line(a.text)}\n\n来源：<${a.url.replace(/[<>\s]/g, encodeURIComponent)}>\n\n原始页面标题：${line(a.pageTitle || a.title)}\n\n采集时间：${a.capturedAt}\n\n采集时的问题：\n${line(a.prompt)}\n\n人工备注：${line(a.notes)}`,
        )
        .join("\n\n---\n\n") +
      `\n\n## 共同结论\n\n${c.common}\n\n${list("common")}\n\n## 冲突点\n\n${c.conflicts}\n\n${list("conflict")}\n\n## 推荐答案\n\n${list("recommended")}\n\n## 人工备注\n\n${c.notes}\n`
    );
  },
}));
