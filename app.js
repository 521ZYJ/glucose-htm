// 血糖监测前端逻辑：模拟数据、预测、图表、历史与危险记录
document.addEventListener("DOMContentLoaded", () => {
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
  const STEP_MINUTES = 5; // 逻辑时间步长
  const STEP_MS = STEP_MINUTES * 60 * 1000;
  const SIM_INTERVAL_MS = 10_000; // 实际模拟间隔
  const RETAIN_MINUTES = 1440; // 数据保留 24h
  const BASELINE = 110;
  const MIN_VAL = 60;
  const MAX_VAL = 220;
  const HISTORY_KEY = "glucoseHistory";
  const DANGER_KEY = "glucoseDangerHistory";
  const VIEW_WINDOW = 120; // 固定窗口大小（分钟）
  const VIEW_MAX_BACK = 1440 - VIEW_WINDOW; // 最多回看 24h-窗口
  const SLIDER_MAX = 1320; // 24h-2h

  const dataPoints = []; // { ts, value }
  let simTimer = null;
  let latestPreds = null;
  let viewBackMinutes = 0; // 0 表示最新，越大越往历史查看
  let lastRenderSnapshot = null;
  let historyCollapsed = false;

  // 工具
  const pad2 = (n) => String(n).padStart(2, "0");
  const formatTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const formatDateTime = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
      d.getMinutes()
    )}:${pad2(d.getSeconds())}`;
  };
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  // 状态显示
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
  const updateStatusText = (state) => {
    const src = sourceSelect.value;
    if (src === "simulated") {
      dataSourceStatus.textContent = `数据源：模拟数据（${state === "running" ? "运行中" : "已暂停"}）`;
    } else if (src === "bluetooth") {
      dataSourceStatus.textContent = "数据源：蓝牙设备（等待接入）";
    } else if (src === "wifi") {
      dataSourceStatus.textContent = "数据源：WiFi 设备（等待接入）";
    }
  };

  // 模拟与预测
  const computeNextValue = (prev) => {
    const drift = (Math.random() - 0.5) * 12;
    const trend = (Math.random() - 0.5) * 4;
    return Number(clamp(prev + drift + trend, MIN_VAL, MAX_VAL).toFixed(1));
  };

  const computePredictions = () => {
    if (dataPoints.length < 2) return null;
    const windowSize = Math.min(12, dataPoints.length);
    const slice = dataPoints.slice(-windowSize);
    const first = slice[0];
    const last = slice[slice.length - 1];
    const minutes = Math.max((last.ts - first.ts) / 60000, 1);
    const slope = (last.value - first.value) / minutes; // mg/dL per min
    const p30 = clamp(last.value + slope * 30, MIN_VAL, MAX_VAL);
    const p60 = clamp(last.value + slope * 60, MIN_VAL, MAX_VAL);
    const trendText = slope > 0.25 ? "上升" : slope < -0.25 ? "下降" : "平稳";
    return {
      list: [
        { ts: last.ts + 30 * 60 * 1000, value: p30, label: "30min", color: "#a855f7" },
        { ts: last.ts + 60 * 60 * 1000, value: p60, label: "60min", color: "#f97316" },
      ],
      trend: trendText,
      slope,
    };
  };

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
    const trendLabel =
      preds.trend === "上升" ? "轻度上升" : preds.trend === "下降" ? "轻度下降" : "相对平稳";
    forecast30Tag.textContent = `趋势：${trendLabel}`;
    forecast60Tag.textContent = `趋势：${trendLabel}`;
  };

  // 建议与范围
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

  const buildAdvice = (currentVal, preds) => {
    const p30 = preds?.list?.[0]?.value;
    const p60 = preds?.list?.[1]?.value;
    const values = [currentVal, p30, p60].filter((v) => typeof v === "number");
    if (!values.length) return "正在获取数据…";
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);

    if (minVal < 70) {
      return "当前或即将出现低血糖风险，请及时补充碳水化合物，并联系医生确认处理方案。";
    }
    if (maxVal > 180) {
      return "血糖偏高或将升高，请关注饮食和运动，按医嘱用药或咨询医生。";
    }
    if (values.every((v) => v >= 80 && v <= 150)) {
      return "血糖相对平稳，建议保持当前生活方式，并按时监测。";
    }
    return "血糖处于可接受范围内，建议继续观察，并保持良好作息与饮食习惯。";
  };

  // 数据记录
  const pruneOld = () => {
    const latestTs = dataPoints.length ? dataPoints[dataPoints.length - 1].ts : Date.now();
    const cutoff = latestTs - RETAIN_MINUTES * 60 * 1000;
    while (dataPoints.length && dataPoints[0].ts < cutoff) dataPoints.shift();
  };

  const getViewWindow = () => {
    if (!dataPoints.length) return null;
    const last = dataPoints[dataPoints.length - 1].ts;
    const earliest = dataPoints[0].ts;
    let windowEnd = last - viewBackMinutes * 60 * 1000;
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

  // 历史与危险记录存取
  const loadHistory = () => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn("加载历史记录失败", e);
      return [];
    }
  };
  const saveHistory = (list) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("保存历史记录失败", e);
    }
  };
  const loadDanger = () => {
    try {
      const raw = localStorage.getItem(DANGER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn("加载危险记录失败", e);
      return [];
    }
  };
  const saveDanger = (list) => {
    try {
      localStorage.setItem(DANGER_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("保存危险记录失败", e);
    }
  };

  const renderHistory = () => {
    const list = loadHistory();
    if (!list.length) {
      historyBody.innerHTML = "";
      historyEmptyHint.style.display = "block";
      return;
    }
    historyEmptyHint.style.display = "none";
    historyBody.innerHTML = list
      .map(
        (item) =>
          `<tr><td>${formatDateTime(item.ts)}</td><td>${item.value.toFixed(1)}</td><td>${item.f30 ?? "--"}</td><td>${item.f60 ?? "--"}</td><td>${item.source || "N/A"}</td></tr>`
      )
      .join("");
  };

  const renderDanger = () => {
    const list = loadDanger();
    if (!list.length) {
      dangerBody.innerHTML = "";
      dangerEmptyHint.style.display = "block";
      return;
    }
    dangerEmptyHint.style.display = "none";
    dangerBody.innerHTML = list
      .map(
        (item) =>
          `<tr><td>${formatDateTime(item.ts)}</td><td>${item.value.toFixed(1)}</td><td>${item.f30 ?? "--"}</td><td>${item.f60 ?? "--"}</td><td>${item.status}</td></tr>`
      )
      .join("");
  };

  const checkAndLogDanger = (currentVal, preds) => {
    const isLow = currentVal < 70;
    const isHigh = currentVal > 180;
    const p30 = preds?.list?.[0]?.value;
    const p60 = preds?.list?.[1]?.value;
    const futureLow = (typeof p30 === "number" && p30 < 70) || (typeof p60 === "number" && p60 < 70);
    const futureHigh = (typeof p30 === "number" && p30 > 180) || (typeof p60 === "number" && p60 > 180);
    const status = isLow || futureLow ? "偏低" : isHigh || futureHigh ? "偏高" : null;
    if (!status) return;
    const entry = {
      ts: Date.now(),
      value: currentVal,
      f30: preds?.list?.[0]?.value ? preds.list[0].value.toFixed(1) : "--",
      f60: preds?.list?.[1]?.value ? preds.list[1].value.toFixed(1) : "--",
      status,
    };
    const list = loadDanger();
    list.push(entry);
    saveDanger(list);
    renderDanger();
  };

  // 绘图
  let hoverTarget = null;

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
    const preds = viewBackMinutes === 0 ? predsExternal || computePredictions() : null;
    const baseMaxTs = range.end;
    const maxPredTs = preds && preds.list && preds.list.length ? preds.list[preds.list.length - 1].ts : baseMaxTs;
    const minTs = range.start;
    const maxTs = viewBackMinutes === 0 ? Math.max(baseMaxTs, maxPredTs) : baseMaxTs;
    const spanTs = Math.max(maxTs - minTs, STEP_MS);

    const values = points.map((p) => p.value);
    if (preds && preds.list) preds.list.forEach((p) => values.push(p.value));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const yMin = Math.max(MIN_VAL - 10, minVal - 10);
    const yMax = Math.min(MAX_VAL + 10, maxVal + 10);
    const ySpan = Math.max(yMax - yMin, 20);

    const xScale = (ts) => pad + ((ts - minTs) / spanTs) * (w - pad * 2);
    const yScale = (val) => h - pad - ((val - yMin) / ySpan) * (h - pad * 2);

    // 背景色块：历史浅蓝，当前±5min浅绿，未来淡黄
    const lastTs = points[points.length - 1].ts;
    const histEndX = xScale(lastTs);
    const greenStartX = xScale(lastTs - 5 * 60 * 1000);
    const greenEndX = xScale(lastTs + 5 * 60 * 1000);
    chartCtx.fillStyle = "rgba(59, 130, 246, 0.08)";
    chartCtx.fillRect(pad, pad, Math.max(greenStartX - pad, 0), h - pad * 2);
    if (viewBackMinutes === 0) {
      chartCtx.fillStyle = "rgba(34, 197, 94, 0.12)";
      chartCtx.fillRect(greenStartX, pad, greenEndX - greenStartX, h - pad * 2);
    }
    if (maxTs > lastTs && viewBackMinutes === 0) {
      const futureXEnd = xScale(maxTs);
      chartCtx.fillStyle = "rgba(250, 204, 21, 0.12)";
      chartCtx.fillRect(greenEndX, pad, futureXEnd - greenEndX, h - pad * 2);
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
    if (preds && preds.list) {
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
    for (let i = 0; i <= gridY; i++) {
      const val = yMin + (ySpan / gridY) * i;
      const y = yScale(val);
      chartCtx.fillText(val.toFixed(0), 4, y + 4);
    }
    for (let i = 0; i <= gridX; i++) {
      const ts = minTs + (spanTs / gridX) * i;
      const x = xScale(ts);
      chartCtx.fillText(formatTime(new Date(ts)), x - 22, h - 6);
    }

    // 存储渲染快照用于 hover
    lastRenderSnapshot = {
      pointsPixels: points.map((p) => ({ x: xScale(p.ts), y: yScale(p.value), ts: p.ts, value: p.value, label: "当前" })),
      predsPixels: preds?.list
        ? preds.list.map((p) => ({ x: xScale(p.ts), y: yScale(p.value), ts: p.ts, value: p.value, label: p.label, color: p.color }))
        : [],
      pad,
      w,
      h,
    };

    // Hover 叠加
    if (hoverTarget) {
      chartCtx.strokeStyle = "#9ca3af";
      chartCtx.setLineDash([4, 4]);
      chartCtx.beginPath();
      chartCtx.moveTo(hoverTarget.x, pad);
      chartCtx.lineTo(hoverTarget.x, h - pad);
      chartCtx.stroke();
      chartCtx.setLineDash([]);
      chartCtx.fillStyle = "#111827";
      chartCtx.font = "12px sans-serif";
      chartCtx.fillText(formatDateTime(hoverTarget.ts), hoverTarget.x - 40, pad - 8);
      chartCtx.fillStyle = hoverTarget.color || "#2563eb";
      chartCtx.beginPath();
      chartCtx.arc(hoverTarget.x, hoverTarget.y, 6, 0, Math.PI * 2);
      chartCtx.fill();
    }
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

  // 模拟流程
  const updateOverview = (val, ts) => {
    currentGlucose.textContent = val.toFixed(1);
    lastUpdateTime.textContent = `最近更新：${formatTime(new Date(ts))}`;
    updateRangeTag(val);
  };

  const addDataPoint = () => {
    const last = dataPoints[dataPoints.length - 1];
    const nextTs = last ? last.ts + STEP_MS : Date.now();
    const nextVal = computeNextValue(last ? last.value : BASELINE);
    dataPoints.push({ ts: nextTs, value: nextVal });
    pruneOld();
    updateOverview(nextVal, nextTs);
    latestPreds = computePredictions();
    updateForecastUI(latestPreds);
    advice.textContent = buildAdvice(nextVal, latestPreds);
    checkAndLogDanger(nextVal, latestPreds);
    renderChart(getVisiblePoints(), latestPreds);
    console.log(`[模拟] ${formatTime(new Date(nextTs))} -> ${nextVal} mg/dL`);
  };

  const seedInitialData = () => {
    const now = Date.now();
    const startTs = now - RETAIN_MINUTES * 60 * 1000;
    let val = BASELINE;
    for (let ts = startTs; ts <= now; ts += STEP_MS) {
      val = computeNextValue(val);
      dataPoints.push({ ts, value: val });
    }
    const last = dataPoints[dataPoints.length - 1];
    updateOverview(last.value, last.ts);
    latestPreds = computePredictions();
    updateForecastUI(latestPreds);
    advice.textContent = buildAdvice(last.value, latestPreds);
    renderDanger();
  };

  const startSimulation = () => {
    if (sourceSelect.value !== "simulated") {
      setButtonState("running");
      setStatusDot("running");
      updateStatusText("running");
      console.warn("当前选择非模拟数据。真实设备接入后再开始接收。");
      return;
    }
    if (simTimer) return;
    setButtonState("running");
    setStatusDot("running");
    updateStatusText("running");
    addDataPoint();
    simTimer = setInterval(() => addDataPoint(), SIM_INTERVAL_MS);
  };

  const pauseSimulation = () => {
    if (simTimer) {
      clearInterval(simTimer);
      simTimer = null;
    }
    setButtonState("paused");
    setStatusDot("paused");
    updateStatusText("paused");
  };

  // 历史保存
  const saveSnapshot = () => {
    if (!dataPoints.length) return;
    const last = dataPoints[dataPoints.length - 1];
    const preds = latestPreds || computePredictions();
    const entry = {
      ts: last.ts,
      value: last.value,
      f30: preds?.list?.[0]?.value ? preds.list[0].value.toFixed(1) : "--",
      f60: preds?.list?.[1]?.value ? preds.list[1].value.toFixed(1) : "--",
      source: sourceSelect.options[sourceSelect.selectedIndex].textContent.trim(),
    };
    const list = loadHistory();
    list.push(entry);
    saveHistory(list);
    renderHistory();
  };

  // 事件绑定
  toggleRunBtn.addEventListener("click", () => {
    const state = toggleRunBtn.dataset.state;
    if (state === "paused") startSimulation();
    else pauseSimulation();
  });

  sourceSelect.addEventListener("change", () => {
    pauseSimulation();
    updateStatusText("paused");
  });

  saveSnapshotBtn.addEventListener("click", saveSnapshot);
  viewHistoryBtn.addEventListener("click", () => {
    const target = document.getElementById("history");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  clearHistoryBtn.addEventListener("click", () => {
    saveHistory([]);
    renderHistory();
  });
  toggleHistoryBtn.addEventListener("click", () => {
    historyCollapsed = !historyCollapsed;
    historyTableWrapper.style.display = historyCollapsed ? "none" : "block";
  });
  clearDangerBtn.addEventListener("click", () => {
    saveDanger([]);
    renderDanger();
  });

  windowSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    viewBackMinutes = clamp(SLIDER_MAX - val, 0, VIEW_MAX_BACK);
    renderChart(getVisiblePoints(), latestPreds);
  });

  // Hover 监听
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

  // 初始化占位
  currentGlucose.textContent = "--.--";
  dataSourceStatus.textContent = "模拟数据待接入";
  forecast30.textContent = "--.--";
  forecast60.textContent = "--.--";
  advice.textContent = "根据实时数据计算建议，稍后填充。";
  rangeTag.textContent = "范围评估：--";
  lastUpdateTime.textContent = "最近更新：--:--";
  windowSlider.value = SLIDER_MAX;

  // 默认状态与数据
  setButtonState("paused");
  setStatusDot("paused");
  sourceSelect.value = "simulated";
  updateStatusText("paused");

  // 预填充 24h 模拟数据并渲染
  seedInitialData();
  adjustCanvas();
  window.addEventListener("resize", adjustCanvas);
  renderChart(getVisiblePoints(), latestPreds);
  renderHistory();
  renderDanger();
});
