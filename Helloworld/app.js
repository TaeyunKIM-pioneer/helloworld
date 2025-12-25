document.addEventListener("DOMContentLoaded", () => {
  // ========= 설정 =========
  const RESET_PASSWORD = "1234"; // 포인트 0일 때만 RESET 비번
  const STORAGE_KEY = "matrix_dice_state_v1";

  // ---------- Utils ----------
  const $ = (id) => document.getElementById(id);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const fmt = (n) => Number(n).toLocaleString("ko-KR");

  function rngInt(min, max) {
    const range = max - min + 1;
    const cryptoObj = window.crypto || window.msCrypto;
    if (cryptoObj?.getRandomValues) {
      const maxUint = 0xFFFFFFFF;
      const limit = maxUint - (maxUint % range);
      const buf = new Uint32Array(1);
      let x;
      do {
        cryptoObj.getRandomValues(buf);
        x = buf[0];
      } while (x >= limit);
      return min + (x % range);
    }
    return min + Math.floor(Math.random() * range);
  }

  // ---------- Elements ----------
  const balEl = $("bal");
  const betEl = $("bet");
  const betSlider = $("betSlider");
  const maxBtn = $("maxBtn");
  const oddBtn = $("oddBtn");
  const evenBtn = $("evenBtn");
  const rollBtn = $("rollBtn");
  const dice = $("dice");
  const face = $("face");
  const pickEl = $("pick");
  const resultEl = $("result");
  const judgeEl = $("judge");
  const roundsEl = $("rounds");
  const streakEl = $("streak");
  const bestEl = $("best");
  const winrateEl = $("winrate");
  const logEl = $("log");
  const clearLogBtn = $("clearLog");
  const resetBtn = $("resetBtn");
  const seedBtn = $("seedBtn");
  const meterFill = $("meterFill");
  const toast = $("toast");
  const toastText = $("toastText");
  const fx = $("fx");

  const soundPill = $("soundPill");
  const soundDot = $("soundDot");
  const soundText = $("soundText");

  // ---------- State ----------
  const state = {
    bal: 1000,
    bet: 50,
    pick: null,
    rounds: 0,
    wins: 0,
    streak: 0,
    best: 0,
    sound: true,
    rolling: false,
    gameOver: false,
  };

  // ====== Persistence (새로고침해도 유지) ======
  function saveState() {
    try {
      const payload = {
        bal: state.bal,
        bet: state.bet,
        pick: state.pick,
        rounds: state.rounds,
        wins: state.wins,
        streak: state.streak,
        best: state.best,
        sound: state.sound,
        gameOver: state.gameOver,
        // UI 저장
        face: face.textContent,
        result: resultEl.textContent,
        judge: judgeEl.textContent,
        judgeColor: judgeEl.style.color || "",
        pickText: pickEl.textContent,
        oddOpacity: oddBtn.style.opacity,
        evenOpacity: evenBtn.style.opacity,
        meterWidth: meterFill.style.width,
        logHtml: logEl.innerHTML,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn("saveState failed:", e);
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved.bal !== "number") return;

      state.bal = saved.bal;
      state.bet = typeof saved.bet === "number" ? saved.bet : 50;
      state.pick = saved.pick ?? null;
      state.rounds = saved.rounds ?? 0;
      state.wins = saved.wins ?? 0;
      state.streak = saved.streak ?? 0;
      state.best = saved.best ?? 0;
      state.sound = saved.sound ?? true;
      state.gameOver = saved.gameOver ?? false;
      state.rolling = false; // 새로고침 후에는 굴리는 중 상태 해제

      // UI 복원
      if (typeof saved.face === "string") face.textContent = saved.face;
      if (typeof saved.result === "string") resultEl.textContent = saved.result;
      if (typeof saved.judge === "string") judgeEl.textContent = saved.judge;
      if (typeof saved.judgeColor === "string") judgeEl.style.color = saved.judgeColor;
      if (typeof saved.pickText === "string") pickEl.textContent = saved.pickText;

      if (typeof saved.oddOpacity === "string") oddBtn.style.opacity = saved.oddOpacity;
      if (typeof saved.evenOpacity === "string") evenBtn.style.opacity = saved.evenOpacity;
      if (typeof saved.meterWidth === "string") meterFill.style.width = saved.meterWidth;

      if (typeof saved.logHtml === "string") logEl.innerHTML = saved.logHtml;
    } catch (e) {
      console.warn("loadState failed:", e);
    }
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    toastText.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1400);
  }

  // ---------- Sound ----------
  let audioCtx = null;
  function beep(freq = 440, dur = 0.06, type = "sine", gain = 0.06) {
    if (!state.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (e) {}
  }
  const sfx = {
    click() { beep(520, 0.05, "square", 0.05); },
    select() { beep(640, 0.06, "triangle", 0.06); },
    roll() {
      beep(220, 0.08, "sawtooth", 0.04);
      setTimeout(() => beep(260, 0.08, "sawtooth", 0.04), 90);
    },
    win() {
      beep(880, 0.07, "triangle", 0.07);
      setTimeout(() => beep(1040, 0.08, "triangle", 0.08), 90);
    },
    lose() {
      beep(180, 0.10, "sine", 0.08);
      setTimeout(() => beep(140, 0.12, "sine", 0.08), 120);
    },
  };

  // ---------- FX ----------
  function playFX(type) { // "win" | "lose"
    fx.dataset.text = type === "win" ? "WIN" : "LOSE";
    fx.classList.remove("win", "lose", "show");
    fx.classList.add(type);
    void fx.offsetWidth;
    fx.classList.add("show");

    dice.classList.remove("dicePop");
    void dice.offsetWidth;
    dice.classList.add("dicePop");

    document.body.classList.remove("shake");
    void document.body.offsetWidth;
    document.body.classList.add("shake");

    setTimeout(() => {
      fx.classList.remove("show");
      document.body.classList.remove("shake");
    }, 900);
  }

  // ---------- UI helpers ----------
  function showResetButton(show) {
    resetBtn.classList.toggle("show", !!show);
  }

  function setControlsEnabled(enabled) {
    [oddBtn, evenBtn, rollBtn, betEl, betSlider, maxBtn, seedBtn].forEach((el) => {
      el.disabled = !enabled;
    });
    clearLogBtn.disabled = false;
  }

  function syncBetUI() {
    const maxBet = Math.max(1, state.bal);
    betEl.max = String(maxBet);
    betSlider.max = String(Math.min(300, maxBet));
    state.bet = clamp(state.bet, 1, maxBet);
    betEl.value = String(state.bet);
    betSlider.value = String(Math.min(Number(betSlider.max), state.bet));
  }

  function updateStats() {
    balEl.textContent = fmt(state.bal);
    roundsEl.textContent = String(state.rounds);
    streakEl.textContent = String(state.streak);
    bestEl.textContent = String(state.best);
    const wr = state.rounds ? Math.round((state.wins / state.rounds) * 100) : 0;
    winrateEl.textContent = String(wr);
  }

  function setPick(p) {
    if (state.gameOver || state.rolling) return;
    state.pick = p;
    pickEl.textContent = p === "odd" ? "홀" : "짝";
    oddBtn.style.opacity = p === "odd" ? "1" : ".75";
    evenBtn.style.opacity = p === "even" ? "1" : ".75";
    sfx.select();
    showToast(`PICK: ${p.toUpperCase()}`);
    saveState();
  }

  function addLog({ win, roll, pick, bet, delta, bal }) {
    const div = document.createElement("div");
    div.className = "item";
    const tag = win ? `<span class="tag win">WIN</span>` : `<span class="tag lose">LOSE</span>`;
    const pickText = pick === "odd" ? "홀" : "짝";
    const parity = roll % 2 === 0 ? "짝" : "홀";
    const deltaText = (delta >= 0 ? `+${fmt(delta)}` : `-${fmt(Math.abs(delta))}`) + " PTS";
    const judge = win ? "성공" : "실패";
    div.innerHTML = `
      ${tag}
      <span class="tag">ROLL: ${roll} (${parity})</span>
      <span class="tag">PICK: ${pickText}</span>
      <div style="margin-top:8px; color: rgba(214,255,231,.86);">
        BET ${fmt(bet)} → <b>${judge}</b> · <b>${deltaText}</b> · BAL <b>${fmt(bal)}</b>
      </div>
    `;
    logEl.prepend(div);
  }

  function enterGameOver() {
    state.gameOver = true;
    state.bal = 0;
    updateStats();
    setControlsEnabled(false);
    showResetButton(true);
    showToast("⚠ 포인트를 모두 사용했습니다. RESET 필요");
    saveState();
  }

  function resetSession() {
    state.bal = 1000;
    state.bet = 50;
    state.pick = null;
    state.rounds = 0;
    state.wins = 0;
    state.streak = 0;
    state.best = 0;
    state.rolling = false;
    state.gameOver = false;

    face.textContent = "?";
    resultEl.textContent = "-";
    judgeEl.textContent = "-";
    judgeEl.style.color = "";
    pickEl.textContent = "-";
    oddBtn.style.opacity = ".75";
    evenBtn.style.opacity = ".75";
    logEl.innerHTML = "";
    meterFill.style.width = "0%";

    showResetButton(false);
    setControlsEnabled(true);
    syncBetUI();
    updateStats();
    showToast("RESET COMPLETE");
    saveState();
  }

  // ---------- Roll ----------
  async function roll() {
    if (state.rolling || state.gameOver) return;

    if (!state.pick) {
      showToast("먼저 홀/짝을 선택!");
      beep(300, 0.06, "sine", 0.06);
      return;
    }

    const bet = Number(betEl.value || state.bet);
    if (!Number.isFinite(bet) || bet < 1) {
      showToast("BET이 이상해요");
      return;
    }
    if (bet > state.bal) {
      showToast("잔액 부족!");
      sfx.lose();
      playFX("lose");
      return;
    }

    state.rolling = true;
    setControlsEnabled(false);
    clearLogBtn.disabled = true;

    dice.classList.add("rolling");
    showToast("ROLLING...");
    sfx.roll();

    // meter
    let meter = 0;
    const meterTimer = setInterval(() => {
      meter = Math.min(100, meter + rngInt(6, 14));
      meterFill.style.width = meter + "%";
    }, 80);

    // rolling animation
    const frames = rngInt(14, 22);
    for (let i = 0; i < frames; i++) {
      face.textContent = String(rngInt(1, 6));
      await new Promise((r) => setTimeout(r, 60 + i * 6));
    }

    const finalRoll = rngInt(1, 6);
    face.textContent = String(finalRoll);

    clearInterval(meterTimer);
    meterFill.style.width = "100%";
    await new Promise((r) => setTimeout(r, 120));

    const isEven = finalRoll % 2 === 0;
    const win =
      (state.pick === "even" && isEven) || (state.pick === "odd" && !isEven);

    state.rounds += 1;
    let delta = 0;

    if (win) {
      delta = bet;
      state.bal += bet;
      state.wins += 1;
      state.streak += 1;
      state.best = Math.max(state.best, state.streak);
      judgeEl.textContent = "WIN";
      judgeEl.style.color = "var(--neon)";
      sfx.win();
      showToast(`WIN! +${fmt(bet)} PTS`);
      playFX("win");
    } else {
      delta = -bet;
      state.bal -= bet;
      state.streak = 0;
      judgeEl.textContent = "LOSE";
      judgeEl.style.color = "var(--bad)";
      sfx.lose();
      showToast(`LOSE! -${fmt(bet)} PTS`);
      playFX("lose");
    }

    resultEl.textContent = `${finalRoll} (${isEven ? "짝" : "홀"})`;
    addLog({ win, roll: finalRoll, pick: state.pick, bet, delta, bal: state.bal });

    dice.classList.remove("rolling");
    meterFill.style.width = "0%";

    updateStats();
    syncBetUI();

    clearLogBtn.disabled = false;
    state.rolling = false;

    if (state.bal <= 0) {
      enterGameOver();
    } else {
      setControlsEnabled(true);
      saveState();
    }
  }

  // ---------- Events ----------
  oddBtn.addEventListener("click", () => setPick("odd"));
  evenBtn.addEventListener("click", () => setPick("even"));
  rollBtn.addEventListener("click", () => {
    sfx.click();
    roll();
  });

  betEl.addEventListener("input", () => {
    if (state.gameOver) return;
    const v = clamp(Number(betEl.value || 1), 1, state.bal);
    state.bet = v;
    betSlider.value = String(Math.min(Number(betSlider.max), v));
    saveState();
  });

  betSlider.addEventListener("input", () => {
    if (state.gameOver) return;
    const v = clamp(Number(betSlider.value || 1), 1, state.bal);
    state.bet = v;
    betEl.value = String(v);
    saveState();
  });

  maxBtn.addEventListener("click", () => {
    if (state.gameOver) return;
    sfx.click();
    state.bet = Math.max(1, state.bal);
    syncBetUI();
    showToast("BET: MAX");
    saveState();
  });

  clearLogBtn.addEventListener("click", () => {
    sfx.click();
    logEl.innerHTML = "";
    showToast("LOG CLEARED");
    saveState();
  });

  seedBtn.addEventListener("click", () => {
    if (state.gameOver || state.rolling) return;
    sfx.click();
    state.pick = null;
    pickEl.textContent = "-";
    resultEl.textContent = "-";
    judgeEl.textContent = "-";
    judgeEl.style.color = "";
    oddBtn.style.opacity = ".75";
    evenBtn.style.opacity = ".75";
    const sep = document.createElement("div");
    sep.className = "item";
    sep.style.opacity = ".8";
    sep.innerHTML = `<span class="tag">NEW SESSION</span><div style="margin-top:8px;">프로토콜을 재동기화합니다…</div>`;
    logEl.prepend(sep);
    showToast("SESSION SYNC");
    saveState();
  });

  // 게임오버 때만 표시되는 RESET + 비밀번호
  resetBtn.addEventListener("click", () => {
    sfx.click();
    if (!state.gameOver) {
      showToast("게임오버 때만 RESET 가능");
      return;
    }
    const pw = prompt("포인트가 모두 소진되었습니다.\n리셋 비밀번호를 입력하세요:");
    if (pw !== RESET_PASSWORD) {
      showToast("❌ 비밀번호가 틀렸습니다");
      sfx.lose();
      playFX("lose");
      return;
    }
    resetSession();
  });

  function toggleSound() {
    state.sound = !state.sound;
    soundDot.classList.toggle("off", !state.sound);
    soundText.textContent = state.sound ? "ON" : "OFF";
    showToast(`SOUND ${state.sound ? "ON" : "OFF"}`);
    sfx.click();
    saveState();
  }
  soundPill.addEventListener("click", toggleSound);
  soundPill.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSound();
    }
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (state.rolling || state.gameOver) return;
    if (e.key === "o" || e.key === "O") setPick("odd");
    if (e.key === "e" || e.key === "E") setPick("even");
    if (e.key === " ") { e.preventDefault(); roll(); }

    if (e.key === "ArrowUp") {
      state.bet = clamp(state.bet + 5, 1, state.bal);
      syncBetUI();
      saveState();
    }
    if (e.key === "ArrowDown") {
      state.bet = clamp(state.bet - 5, 1, state.bal);
      syncBetUI();
      saveState();
    }
  });

  // ---------- Matrix rain ----------
  const canvas = $("rain");
  const ctx = canvas.getContext("2d", { alpha: true });
  const glyphs = "アァカサタナハマヤャラワン0123456789$#*+<>[]{}";
  let cols = 0;
  let drops = [];

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    cols = Math.floor(window.innerWidth / 16);
    drops = new Array(cols).fill(0).map(() => rngInt(0, Math.floor(window.innerHeight / 16)));
  }
  window.addEventListener("resize", resize);
  resize();

  function rainTick() {
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.font = "14px " + getComputedStyle(document.documentElement).getPropertyValue("--mono");
    for (let i = 0; i < cols; i++) {
      const x = i * 16;
      const y = drops[i] * 16;
      const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
      ctx.fillStyle = "rgba(0,255,122,0.65)";
      ctx.fillText(ch, x, y);

      if (y > window.innerHeight && Math.random() > 0.975) drops[i] = 0;
      else drops[i] += Math.random() > 0.5 ? 1 : 0.5;
    }
    requestAnimationFrame(rainTick);
  }
  rainTick();

  // ---------- Init ----------
  // 1) 저장된 상태 먼저 불러오기
  loadState();

  // 2) 사운드 UI 반영
  soundDot.classList.toggle("off", !state.sound);
  soundText.textContent = state.sound ? "ON" : "OFF";

  // 3) 게임오버면 컨트롤 잠그고 reset 노출
  if (state.gameOver || state.bal <= 0) {
    state.gameOver = true;
    state.bal = 0;
    setControlsEnabled(false);
    showResetButton(true);
  } else {
    showResetButton(false);
    setControlsEnabled(true);
  }

  // 4) 베팅/스탯 표시
  updateStats();
  syncBetUI();

  // 5) pick이 저장되어 있으면 버튼 opacity 정리(혹시 저장값이 없을 수도 있으니 안전 처리)
  if (state.pick === "odd") {
    oddBtn.style.opacity = "1";
    evenBtn.style.opacity = ".75";
  } else if (state.pick === "even") {
    oddBtn.style.opacity = ".75";
    evenBtn.style.opacity = "1";
  } else {
    oddBtn.style.opacity = ".75";
    evenBtn.style.opacity = ".75";
  }

  // 6) 첫 저장(초기 상태 확보)
  saveState();

  showToast("READY");
});
