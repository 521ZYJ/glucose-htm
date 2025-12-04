// 前端逻辑（改为从本地后端获取数据并同步历史/危险记录）
document.addEventListener("DOMContentLoaded", () => {
  const API_BASE = "http://10.89.205.185:3000";
  const $ = (id) => document.getElementById(id);

  // UI 元素
  const currentGlucose = $("currentGlucose");
  const dataSourceStatus = $("dataSourceStatus");
  const forecast30 = $("forecast30");
  const forecast60 = $("forecast60");
  const forecast30Tag = $("forecast30Tag");
  const forecast60Tag = $("forecast60Tag");
  const advice = $("healthAdvice");
  const rangeTag = $("rangeTag");
  const lastUpdateTime = $("lastUpdateTime");
  const toggleRunBtn = $("toggleRunBtn");
  const sourceSelect = $("sourceSelect");
  const chartCanvas = $("glucoseChart");
  const chartCtx = chartCanvas.getContext("2d");
  const statusDot = $("statusDot");
  const saveSnapshotBtn = $("saveSnapshotBtn");
  const viewHistoryBtn = $("viewHistoryBtn");
  const clearHistoryBtn = $("clearHistoryBtn");
  const toggleHistoryBtn = $("toggleHistoryBtn");
  const historyBody = $("historyBody");
  const historyEmptyHint = $("historyEmptyHint");
  const historyTableWrapper = $("historyTableWrapper");
  const windowSlider = $("windowSlider");
  const dangerBody = $("dangerBody");
  const dangerEmptyHint = $("dangerEmptyHint");
  const clearDangerBtn = $("clearDangerBtn");

  // 常量与状态
  const VIEW_WINDOW = 120; // 2 小时固定窗口
  const VIEW_MAX_BACK = 1440 - VIEW_WINDOW;
  const SLIDER_MAX = 1320;
  const MIN_VAL = 60;
  const MAX_VAL = 220;

  let viewBackMinutes = 0; // 0=最新
  let lastRenderSnapshot = null;
  let latestPreds = null;
  let dataPoints = [];
  let simTimer = null;

  // 工具
  const pad2 = (n) => String(n).padStart(2, "0");
  const formatTime = (ts) => {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };
  const formatDateTime = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
      d.getMinutes()
    )}:${pad2(d.getSeconds())}`;
  };
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  // UI 状态
  const setButtonState = (state) => {
    toggleRunBtn.dataset.state = state;
    if (state === "running") {
      toggleRunBtn.textContent = "暂停";
      toggleRunBtn.classList.remove("is-paused");
      toggleRunBtn.classList.add("is-running");
    } else {
      toggleRunBtn.textContent = "开始";
      toggleRunBtn.classList.remove("is-running");
      toggleRunBtn.classList.add("is-paused");
    }
  };
  const setStatusDot = (state) => {
    statusDot.style.background = state === "running" ? "#22c55e" : "#cbd5e0";
  };
  const updateRangeTag = (val) => {
    if (val < 70) {
      rangeTag.textContent = "范围评估：偏低";
      rangeTag.style.background = "#e0f2fe";
      rangeTag.style.color = "#0ea5e9";
    } else if (val > 180) {
      rangeTag.textContent = "范围评估：偏高";
      rangeTag.style.background = "#fef3c7";
      rangeTag.style.color = "#d97706";
    } else {
      rangeTag.textContent = "范围评估：建议范围";
      rangeTag.style.background = "#dcfce7";
      rangeTag.style.color = "#16a34a";
    }
  };

  // 数据请求
  const fetchData = async () => {
    const src = sourceSelect.value;
    const res = await fetch(`${API_BASE}/api/data?source=${src}`);
    const json = await res.json();
    dataPoints = json.points || [];
    latestPreds = json.preds || null;
    const last = json.current || dataPoints[dataPoints.length - 1];
    if (!last) return;
    updateOverview(last.value, last.ts);
    updateForecastUI(latestPreds);
    advice.textContent = json.advice || "正在获取数据…";
    dataSourceStatus.textContent = json.status || "数据源";
    renderChart(getVisiblePoints(), latestPreds);
  };

  const fetchHistory = async () => {
    const res = await fetch(`${API_BASE}/api/history`);
    const list = await res.json();
    if (!list.length) {
      historyBody.innerHTML = "";
      historyEmptyHint.style.display = "block";
      return;
    }
    historyEmptyHint.style.display = "none";
    historyBody.innerHTML = list
      .map(
        (item) =>
          `<tr><td>${formatDateTime(item.ts)}</td><td>${item.value?.toFixed?.(1) ?? "--"}</td><td>${item.f30 ?? "--"}</td><td>${item.f60 ?? "--"}</td><td>${item.source || "N/A"}</td></tr>`
      )
      .join("");
  };

  const fetchDanger = async () => {
    const res = await fetch(`${API_BASE}/api/danger`);
    const list = await res.json();
    if (!list.length) {
      dangerBody.innerHTML = "";
      dangerEmptyHint.style.display = "block";
      return;
    }
    dangerEmptyHint.style.display = "none";
    dangerBody.innerHTML = list
      .map(
        (item) =>
          `<tr><td>${formatDateTime(item.ts)}</td><td>${item.value?.toFixed?.(1) ?? "--"}</td><td>${item.f30 ?? "--"}</td><td>${item.f60 ?? "--"}</td><td>${item.status || "异常"}</td></tr>`
      )
      .join("");
  };

  const saveSnapshot = async () => {
    if (!dataPoints.length) return;
    const last = dataPoints[dataPoints.length - 1];
    const p30 = latestPreds?.list?.[0]?.value ? latestPreds.list[0].value.toFixed(1) : "--";
    const p60 = latestPreds?.list?.[1]?.value ? latestPreds.list[1].value.toFixed(1) : "--";
    await fetch(`${API_BASE}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: last.value, f30: p30, f60: p60, source: sourceSelect.value })
    });
    fetchHistory();
  };

  const clearHistory = async () => {
    await fetch(`${API_BASE}/api/history`, { method: "DELETE" });
    fetchHistory();
  };

  const clearDanger = async () => {
    await fetch(`${API_BASE}/api/danger`, { method: "DELETE" });
    fetchDanger();
  };

  // 预测 UI
  const updateForecastUI = (preds) => {
    if (!preds) {
      forecast30.textContent = "--.--";
      forecast60.textContent = "--.--";
      forecast30Tag.textContent = "趋势：--";
      forecast60Tag.textContent = "趋势：--";
      return;
    }
    const [p30, p60] = preds.list;
    forecast30.textContent = p30.value.toFixed(1);
    forecast60.textContent = p60.value.toFixed(1);
    const trendLabel = preds.trend === "上升" ? "轻度上升" : preds.trend === "下降" ? "轻度下降" : "相对平稳";
    forecast30Tag.textContent = `趋势：${trendLabel}`;
    forecast60Tag.textContent = `趋势：${trendLabel}`;
  };

  // 视图范围
  const getViewWindow = () => {
    if (!dataPoints.length) return null;
    const lastTs = dataPoints[dataPoints.length - 1].ts;
    const earliest = dataPoints[0].ts;
    let windowEnd = lastTs - viewBackMinutes * 60 * 1000;
    let windowStart = windowEnd - VIEW_WINDOW * 60 * 1000;
    if (windowStart < earliest) {
      windowStart = earliest;
      windowEnd = windowStart + VIEW_WINDOW * 60 * 1000;
    }
    return { start: windowStart, end: windowEnd };
  };
  const getVisiblePoints = () => {
    const range = getViewWindow();
    if (!range) return [];
    return dataPoints.filter((p) => p.ts >= range.start && p.ts <= range.end);
  };

  // 绘图
  const renderChart = (points, predsExternal) => {
    if (!chartCtx) return;
    const rect = chartCanvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    chartCtx.clearRect(0, 0, w, h);

    const range = getViewWindow();
    if (!points || points.length < 2 || !range) {
      chartCtx.fillStyle = "#94a3b8";
      chartCtx.font = "13px sans-serif";
      chartCtx.fillText("等待足够的数据绘制曲线…", 14, h / 2);
      return;
    }

    const pad = 28;
    const preds = viewBackMinutes === 0 ? predsExternal || latestPreds : null;
    const baseMaxTs = range.end;
    const maxPredTs = preds?.list?.length ? preds.list[preds.list.length - 1].ts : baseMaxTs;
    const minTs = range.start;
    const maxTs = viewBackMinutes === 0 ? Math.max(baseMaxTs, maxPredTs) : baseMaxTs;
    const spanTs = Math.max(maxTs - minTs, 1);

    const values = points.map((p) => p.value);
    if (preds?.list) preds.list.forEach((p) => values.push(p.value));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const yMin = Math.max(MIN_VAL - 10, minVal - 10);
    const yMax = Math.min(MAX_VAL + 10, maxVal + 10);
    const ySpan = Math.max(yMax - yMin, 20);

    const xScale = (ts) => pad + ((ts - minTs) / spanTs) * (w - pad * 2);
    const yScale = (val) => h - pad - ((val - yMin) / ySpan) * (h - pad * 2);

    // 背景色块
    const lastTs = points[points.length - 1].ts;
    const histEndX = xScale(lastTs);
    chartCtx.fillStyle = "rgba(59, 130, 246, 0.08)";
    chartCtx.fillRect(pad, pad, Math.max(histEndX - pad, 0), h - pad * 2);
    if (viewBackMinutes === 0 && preds?.list) {
      const futureXEnd = xScale(maxTs);
      chartCtx.fillStyle = "rgba(250, 204, 21, 0.12)";
      chartCtx.fillRect(histEndX, pad, futureXEnd - histEndX, h - pad * 2);
    }
    if (viewBackMinutes === 0) {
      const greenStartX = xScale(lastTs - 5 * 60 * 1000);
      const greenEndX = xScale(lastTs + 5 * 60 * 1000);
      chartCtx.fillStyle = "rgba(34, 197, 94, 0.12)";
      chartCtx.fillRect(greenStartX, pad, greenEndX - greenStartX, h - pad * 2);
    }

    // 网格
    chartCtx.strokeStyle = "#e5e7eb";
    chartCtx.lineWidth = 1;
    chartCtx.beginPath();
    const gridY = 4;
    for (let i = 0; i <= gridY; i++) {
      const y = pad + ((h - pad * 2) / gridY) * i;
      chartCtx.moveTo(pad, y);
      chartCtx.lineTo(w - pad, y);
    }
    const gridX = 4;
    for (let i = 0; i <= gridX; i++) {
      const x = pad + ((w - pad * 2) / gridX) * i;
      chartCtx.moveTo(x, pad);
      chartCtx.lineTo(x, h - pad);
    }
    chartCtx.stroke();

    // 折线
    chartCtx.strokeStyle = "#2563eb";
    chartCtx.lineWidth = 2;
    chartCtx.beginPath();
    points.forEach((p, idx) => {
      const x = xScale(p.ts);
      const y = yScale(p.value);
      if (idx === 0) chartCtx.moveTo(x, y);
      else chartCtx.lineTo(x, y);
    });
    chartCtx.stroke();

    // 历史点
    chartCtx.fillStyle = "#2563eb";
    points.forEach((p) => {
      const x = xScale(p.ts);
      const y = yScale(p.value);
      chartCtx.beginPath();
      chartCtx.arc(x, y, 3, 0, Math.PI * 2);
      chartCtx.fill();
    });
    // 最新点
    const last = points[points.length - 1];
    const lx = xScale(last.ts);
    const ly = yScale(last.value);
    chartCtx.fillStyle = "#16a34a";
    chartCtx.beginPath();
    chartCtx.arc(lx, ly, 4.5, 0, Math.PI * 2);
    chartCtx.fill();
    chartCtx.fillStyle = "#111827";
    chartCtx.font = "12px sans-serif";
    chartCtx.fillText(`${last.value.toFixed(1)} mg/dL`, lx + 8, ly - 8);

    // 预测点
    if (preds?.list) {
      preds.list.forEach((p) => {
        const x = xScale(p.ts);
        const y = yScale(p.value);
        chartCtx.fillStyle = p.color;
        chartCtx.beginPath();
        chartCtx.arc(x, y, 5, 0, Math.PI * 2);
        chartCtx.fill();
        chartCtx.fillStyle = "#1f2937";
        chartCtx.font = "12px sans-serif";
        chartCtx.fillText(p.label, x - 16, y - 14);
        chartCtx.fillText(`${p.value.toFixed(1)} mg/dL`, x - 28, y + 18);
      });
    }

    // 坐标轴刻度
    chartCtx.fillStyle = "#6b7280";
    chartCtx.font = "12px sans-serif";
    const gridYLabels = 4;
    for (let i = 0; i <= gridYLabels; i++) {
      const val = yMin + (ySpan / gridYLabels) * i;
      const y = yScale(val);
      chartCtx.fillText(val.toFixed(0), 4, y + 4);
    }
    const gridXLabels = 4;
    for (let i = 0; i <= gridXLabels; i++) {
      const ts = minTs + (spanTs / gridXLabels) * i;
      const x = pad + ((ts - minTs) / spanTs) * (w - pad * 2);
      chartCtx.fillText(formatTime(ts), x - 22, h - 6);
    }

    // Hover 叠加
    if (hoverTarget) {
      chartCtx.strokeStyle = "#9ca3af";
      chartCtx.setLineDash([4, 4]);
      chartCtx.beginPath();
      chartCtx.moveTo(hoverTarget.x, pad);
      chartCtx.lineTo(hoverTarget.x, h - pad);
      chartCtx.stroke();
      chartCtx.setLineDash([]);
      chartCtx.fillStyle = hoverTarget.color || "#2563eb";
      chartCtx.beginPath();
      chartCtx.arc(hoverTarget.x, hoverTarget.y, 6, 0, Math.PI * 2);
      chartCtx.fill();
      chartCtx.fillStyle = "#111827";
      chartCtx.fillText(formatDateTime(hoverTarget.ts), hoverTarget.x - 40, pad - 8);
    }

    // 存储用于 hover
    lastRenderSnapshot = {
      pointsPixels: points.map((p) => ({ x: xScale(p.ts), y: yScale(p.value), ts: p.ts, value: p.value, label: "当前" })),
      predsPixels: preds?.list
        ? preds.list.map((p) => ({ x: xScale(p.ts), y: yScale(p.value), ts: p.ts, value: p.value, label: p.label, color: p.color }))
        : []
    };
  };

  const adjustCanvas = () => {
    if (!chartCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = chartCanvas.getBoundingClientRect();
    chartCanvas.width = width * dpr;
    chartCanvas.height = height * dpr;
    chartCtx.setTransform(1, 0, 0, 1, 0, 0);
    chartCtx.scale(dpr, dpr);
    renderChart(getVisiblePoints(), latestPreds);
  };

  // Hover
  let hoverTarget = null;
  chartCanvas.addEventListener("mousemove", (e) => {
    if (!lastRenderSnapshot) return;
    const rect = chartCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const candidates = [...lastRenderSnapshot.pointsPixels, ...lastRenderSnapshot.predsPixels];
    let nearest = null;
    let minDist = Infinity;
    candidates.forEach((p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist && dist <= 12) {
        minDist = dist;
        nearest = p;
      }
    });
    hoverTarget = nearest;
    renderChart(getVisiblePoints(), latestPreds);
  });
  chartCanvas.addEventListener("mouseleave", () => {
    hoverTarget = null;
    renderChart(getVisiblePoints(), latestPreds);
  });

  // 事件
  toggleRunBtn.addEventListener("click", async () => {
    const state = toggleRunBtn.dataset.state;
    if (state === "paused") {
      setButtonState("running");
      setStatusDot("running");
      await fetchData();
      if (!simTimer) simTimer = setInterval(fetchData, 10_000);
    } else {
      setButtonState("paused");
      setStatusDot("paused");
      if (simTimer) {
        clearInterval(simTimer);
        simTimer = null;
      }
    }
  });

  sourceSelect.addEventListener("change", async () => {
    await fetchData();
  });

  saveSnapshotBtn.addEventListener("click", saveSnapshot);
  viewHistoryBtn.addEventListener("click", () => {
    const target = document.getElementById("history");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  clearHistoryBtn.addEventListener("click", clearHistory);
  toggleHistoryBtn.addEventListener("click", () => {
    const hidden = historyTableWrapper.style.display === "none";
    historyTableWrapper.style.display = hidden ? "block" : "none";
  });
  clearDangerBtn.addEventListener("click", clearDanger);

  windowSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    viewBackMinutes = clamp(SLIDER_MAX - val, 0, VIEW_MAX_BACK);
    renderChart(getVisiblePoints(), latestPreds);
  });

  window.addEventListener("resize", adjustCanvas);

  // 初始化
  currentGlucose.textContent = "--.--";
  dataSourceStatus.textContent = "模拟数据待接入";
  forecast30.textContent = "--.--";
  forecast60.textContent = "--.--";
  advice.textContent = "根据实时数据计算建议，稍后填充。";
  rangeTag.textContent = "范围评估：--";
  lastUpdateTime.textContent = "最近更新：--:--";
  windowSlider.value = SLIDER_MAX;
  setButtonState("paused");
  setStatusDot("paused");

  // 首次加载数据
  fetchData().then(() => {
    adjustCanvas();
    fetchHistory();
    fetchDanger();
  });

  // 辅助函数
  function updateOverview(val, ts) {
    currentGlucose.textContent = val.toFixed(1);
    lastUpdateTime.textContent = `最近更新：${formatTime(ts)}`;
    updateRangeTag(val);
  }
});
