// 子任务 2：数据模型与血糖模拟引擎（mg/dL，5 分钟一个点）
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const currentGlucose = $("currentGlucose");
  const dataSourceStatus = $("dataSourceStatus");
  const forecast30 = $("forecast30");
  const forecast60 = $("forecast60");
  const advice = $("healthAdvice");
  const rangeTag = $("rangeTag");
  const lastUpdateTime = $("lastUpdateTime");
  const toggleRunBtn = $("toggleRunBtn");
  const sourceSelect = $("sourceSelect");

  // 模拟参数（mg/dL）
  const STEP_MINUTES = 5; // 每 5 分钟生成一个点
  const STEP_MS = STEP_MINUTES * 60 * 1000;
  const RETAIN_MINUTES = 120; // 只保留最近 2 小时数据
  const BASELINE = 110; // 初始基准
  const MIN_VAL = 60;
  const MAX_VAL = 220;

  const dataPoints = []; // { ts: number, value: number }
  let simTimer = null;

  const formatTime = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

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

  const computeNextValue = (prev) => {
    // 温和随机波动 + 小幅趋势
    const drift = (Math.random() - 0.5) * 12; // 上下浮动
    const trend = (Math.random() - 0.5) * 4; // 轻微趋势
    const next = clamp(prev + drift + trend, MIN_VAL, MAX_VAL);
    return Number(next.toFixed(1));
  };

  const addDataPoint = () => {
    const last = dataPoints[dataPoints.length - 1];
    const nextTs = Date.now();
    const nextVal = computeNextValue(last ? last.value : BASELINE);
    dataPoints.push({ ts: nextTs, value: nextVal });
    pruneOld();
    updateOverview(nextVal, nextTs);
    console.log(`[模拟] ${formatTime(new Date(nextTs))} -> ${nextVal} mg/dL`);
  };

  const pruneOld = () => {
    const cutoff = Date.now() - RETAIN_MINUTES * 60 * 1000;
    while (dataPoints.length && dataPoints[0].ts < cutoff) {
      dataPoints.shift();
    }
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

  const updateOverview = (val, ts) => {
    currentGlucose.textContent = val.toFixed(1);
    lastUpdateTime.textContent = `最近更新：${formatTime(new Date(ts))}`;
    updateRangeTag(val);
  };

  const startSimulation = () => {
    if (sourceSelect.value !== "simulated") {
      setButtonState("running");
      updateStatusText("running");
      console.warn("当前选择非模拟数据。真实设备接入后再开始接收。");
      return;
    }
    if (simTimer) return;
    setButtonState("running");
    updateStatusText("running");
    addDataPoint(); // 立即打一针
    simTimer = setInterval(addDataPoint, STEP_MS);
  };

  const pauseSimulation = () => {
    if (simTimer) {
      clearInterval(simTimer);
      simTimer = null;
    }
    setButtonState("paused");
    updateStatusText("paused");
  };

  // 事件绑定：开始/暂停单键
  toggleRunBtn.addEventListener("click", () => {
    const state = toggleRunBtn.dataset.state;
    if (state === "paused") {
      startSimulation();
    } else {
      pauseSimulation();
    }
  });

  // 数据源切换：切换到非模拟时自动暂停
  sourceSelect.addEventListener("change", () => {
    pauseSimulation();
    updateStatusText("paused");
  });

  // 初始化占位文本
  currentGlucose.textContent = "--.--";
  dataSourceStatus.textContent = "模拟数据待接入";
  forecast30.textContent = "--.--";
  forecast60.textContent = "--.--";
  advice.textContent = "根据实时数据计算建议，稍后填充。";
  rangeTag.textContent = "范围评估：--";
  lastUpdateTime.textContent = "最近更新：--:--";

  // 默认按钮状态与数据源
  setButtonState("paused");
  sourceSelect.value = "simulated";
  updateStatusText("paused");

  // 预填充最近 2 小时的模拟数据，便于立即看到曲线/数值
  seedInitialData();
});
