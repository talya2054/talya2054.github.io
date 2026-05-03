const APP_KEY = "recipe_atlas_v1";
const DEFAULT_SYNC_CONFIG = {
  enabled: false,
  supabaseUrl: "",
  anonKey: "",
  table: "app_store",
  rowId: "main",
  firebaseProjectId: "",
  firebaseApiKey: "",
  geminiApiKey: "",
  geminiModel: "gemini-1.5-flash",
};
const CATEGORIES = ["Meal", "Dessert", "Breakfast", "Snack", "Soup", "Salad", "Bread", "Drink"];

const sampleRecipeText = `Lemon Olive Oil Cake
Ingredients
1 1/2 cups all-purpose flour
2 tsp baking powder
1/2 tsp salt
3 large eggs
3/4 cup sugar
1/2 cup olive oil
1/2 cup milk
2 tbsp lemon juice
1 tbsp lemon zest

Instructions
Preheat oven to 350F.
Whisk flour, baking powder, and salt.
Beat eggs and sugar until pale.
Stream in olive oil and milk.
Bake for 35 minutes.`;

const substitutionMap = {
  milk: ["oat milk", "almond milk"],
  egg: ["flax egg", "applesauce"],
  butter: ["olive oil", "coconut oil"],
  sugar: ["brown sugar", "maple syrup"],
  flour: ["cake flour", "1:1 gluten-free blend"],
};

let analyzeInFlight = false;

init();

async function init() {
  await hydrateFromCloud();
  const store = loadStore();
  if (!store.recipes.length) {
    seedStore(store);
  }
  const page = document.body.dataset.page;
  if (page === "home") initHome();
  if (page === "recipes") initRecipes();
  if (page === "add") initAddRecipe();
  if (page === "detail") initDetail();
}

function loadStore() {
  const raw = localStorage.getItem(APP_KEY);
  if (raw) return JSON.parse(raw);
  return { recipes: [] };
}

function saveStore(store) {
  localStorage.setItem(APP_KEY, JSON.stringify(store));
  queueCloudSave(store);
}

function seedStore(store) {
  const parsed = parseRecipe(sampleRecipeText, "Dessert", "Lemon Olive Oil Cake");
  store.recipes.push(parsed);
  saveStore(store);
}

function initHome() {
  const store = loadStore();
  const stats = [
    { label: "Total recipes", value: String(store.recipes.length) },
    { label: "Categories used", value: String(new Set(store.recipes.map((r) => r.category)).size) },
    { label: "Reviews", value: String(store.recipes.reduce((sum, r) => sum + r.reviews.length, 0)) },
  ];
  document.querySelector("#statsGrid").innerHTML = stats
    .map((s) => `<article class="stat-card"><div class="stat-label">${escapeHtml(s.label)}</div><div class="stat-value">${s.value}</div></article>`)
    .join("");

  const recent = [...store.recipes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  renderRecipeCards(recent, document.querySelector("#recentRecipes"));

  setupSyncControls();
}

function initRecipes() {
  const store = loadStore();
  const searchInput = document.querySelector("#searchInput");
  const categoryFilter = document.querySelector("#categoryFilter");
  const sortBy = document.querySelector("#sortBy");
  const allRecipes = document.querySelector("#allRecipes");

  categoryFilter.innerHTML = [`<option value="all">All categories</option>`]
    .concat(CATEGORIES.map((c) => `<option value="${c}">${c}</option>`))
    .join("");

  const draw = () => {
    const query = searchInput.value.trim().toLowerCase();
    const category = categoryFilter.value;
    const sorted = [...store.recipes].filter((recipe) => {
      const inCategory = category === "all" || recipe.category === category;
      const haystack = [
        recipe.title,
        recipe.category,
        recipe.ingredients.map((x) => `${x.name} ${x.original || ""}`).join(" "),
        (recipe.steps || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return inCategory && haystack.includes(query);
    });

    if (sortBy.value === "name") sorted.sort((a, b) => a.title.localeCompare(b.title));
    if (sortBy.value === "category") sorted.sort((a, b) => a.category.localeCompare(b.category));
    if (sortBy.value === "newest") sorted.sort((a, b) => b.createdAt - a.createdAt);
    renderRecipeCards(sorted, allRecipes);
  };

  [searchInput, categoryFilter, sortBy].forEach((el) => el.addEventListener("input", draw));
  draw();
}

function initAddRecipe() {
  const store = loadStore();
  const editId = new URLSearchParams(location.search).get("edit");
  const editingRecipe = editId ? store.recipes.find((r) => r.id === editId) : null;
  const category = document.querySelector("#recipeCategory");
  const urlInput = document.querySelector("#recipeUrl");
  const titleInput = document.querySelector("#recipeTitle");
  const source = document.querySelector("#recipeSource");
  const previewBox = document.querySelector("#saveStatus");
  const ingredientsEditor = document.querySelector("#ingredientsEditor");
  const stepsEditor = document.querySelector("#stepsEditor");
  const analyzeBtn = document.querySelector("#analyzeBtn");
  const previewBtn = document.querySelector("#previewBtn");
  const saveBtn = document.querySelector("#saveBtn");
  const fetchBtn = document.querySelector("#fetchUrlBtn");

  category.innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  if (editingRecipe) {
    titleInput.value = editingRecipe.title;
    category.value = editingRecipe.category;
    ingredientsEditor.value = editingRecipe.ingredients.map((x) => x.original || x.name).join("\n");
    stepsEditor.value = (editingRecipe.steps || []).join("\n");
    source.value = editingRecipe.sourceText || "";
    urlInput.value = editingRecipe.sourceUrl || "";
    previewBox.textContent = "Editing mode: update fields and save.";
    saveBtn.textContent = "Update in Cloud";
  }

  analyzeBtn.addEventListener("click", async () => {
    if (analyzeInFlight) {
      previewBox.textContent = "AI request already in progress. Please wait.";
      return;
    }
    const raw = source.value.trim();
    if (!raw) {
      previewBox.textContent = "Please paste a recipe first.";
      return;
    }
    if (location.protocol === "file:") {
      previewBox.textContent =
        "AI analysis is blocked in file:// mode. Open the deployed HTTPS site (GitHub Pages/Firebase Hosting) and try again.";
      return;
    }
    previewBox.textContent = "Analyzing with AI...";
    analyzeInFlight = true;
    analyzeBtn.disabled = true;
    try {
      const aiRecipe = await analyzeRecipeWithGemini(raw);
      titleInput.value = aiRecipe.title || titleInput.value;
      if (CATEGORIES.includes(aiRecipe.category)) category.value = aiRecipe.category;
      ingredientsEditor.value = (aiRecipe.ingredients || []).join("\n");
      stepsEditor.value = (aiRecipe.steps || []).map(convertFahrenheitTextToCelsius).join("\n");
      previewBox.textContent = "AI analysis complete. You can edit anything before saving.";
    } catch (error) {
      previewBox.textContent = `AI analysis failed: ${error.message}. You can use Fallback Parse and edit manually.`;
    } finally {
      analyzeInFlight = false;
      analyzeBtn.disabled = false;
    }
  });

  previewBtn.addEventListener("click", () => {
    const parsed = parseRecipe(source.value, category.value, titleInput.value.trim());
    titleInput.value = parsed.title;
    ingredientsEditor.value = parsed.ingredients.map((x) => x.original).join("\n");
    stepsEditor.value = parsed.steps.map(convertFahrenheitTextToCelsius).join("\n");
    previewBox.innerHTML = `${renderPreview(parsed)}<p>Fallback parse loaded into editable fields.</p>`;
  });

  saveBtn.addEventListener("click", async () => {
    const parsed = buildRecipeFromEditors({
      title: titleInput.value.trim(),
      category: category.value,
      ingredientsText: ingredientsEditor.value,
      stepsText: stepsEditor.value,
      sourceText: source.value,
    });
    if (urlInput.value.trim()) parsed.sourceUrl = urlInput.value.trim();
    if (editingRecipe) {
      const idx = store.recipes.findIndex((r) => r.id === editingRecipe.id);
      if (idx >= 0) {
        parsed.id = editingRecipe.id;
        parsed.createdAt = editingRecipe.createdAt;
        parsed.reviews = editingRecipe.reviews || [];
        parsed.snapshots = editingRecipe.snapshots || [];
        store.recipes[idx] = parsed;
      } else {
        store.recipes.push(parsed);
      }
    } else {
      store.recipes.push(parsed);
    }
    saveStore(store);
    previewBox.textContent = "Saving to cloud...";
    try {
      await saveRecipeToFirestore(parsed);
      previewBox.textContent = "Recipe saved successfully!";
      location.href = `recipe.html?id=${parsed.id}`;
    } catch (error) {
      previewBox.textContent = "Saved locally, but cloud save failed. Check Firebase config and rules.";
      location.href = `recipe.html?id=${parsed.id}`;
    }
  });

  fetchBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    previewBox.textContent = "Importing from link...";
    try {
      const text = await fetchRecipeTextFromUrl(url);
      source.value = text.slice(0, 18000);
      if (!titleInput.value.trim()) {
        titleInput.value = guessTitleFromText(text) || "";
      }
      previewBox.textContent = "Link import completed. You can run AI analysis now.";
    } catch (err) {
      previewBox.textContent = `Could not import this link automatically: ${err.message}`;
    }
  });
}

function initDetail() {
  const store = loadStore();
  const id = new URLSearchParams(location.search).get("id");
  const recipe = store.recipes.find((r) => r.id === id);
  if (!recipe) {
    document.querySelector(".container").innerHTML = `<section class="panel"><div class="empty">Recipe not found.</div></section>`;
    return;
  }

  const recipeName = document.querySelector("#recipeName");
  const categoryTag = document.querySelector("#recipeCategoryTag");
  const ingredientList = document.querySelector("#ingredientList");
  const stepList = document.querySelector("#stepList");
  const scaleSelect = document.querySelector("#scaleSelect");
  const customScale = document.querySelector("#customScale");
  const applyScale = document.querySelector("#applyScale");
  const scaleHint = document.querySelector("#scaleHint");
  const cookModeBtn = document.querySelector("#cookModeBtn");
  const printBtn = document.querySelector("#printBtn");
  const editRecipeBtn = document.querySelector("#editRecipeBtn");
  const reviewText = document.querySelector("#reviewText");
  const reviewRating = document.querySelector("#reviewRating");
  const reviewImage = document.querySelector("#reviewImage");
  const saveReviewBtn = document.querySelector("#saveReviewBtn");
  const snapshotBtn = document.querySelector("#snapshotBtn");
  const snapshotList = document.querySelector("#snapshotList");
  const subIngredient = document.querySelector("#subIngredient");
  const subSuggestBtn = document.querySelector("#subSuggestBtn");
  const subResult = document.querySelector("#subResult");

  if (!Array.isArray(recipe.snapshots)) recipe.snapshots = [];

  recipeName.textContent = recipe.title;
  categoryTag.textContent = recipe.category;
  let currentScale = 1;
  let wakeLock = null;

  const render = () => {
    ingredientList.innerHTML = recipe.ingredients.map((item) => renderIngredient(item, currentScale)).join("");
    stepList.innerHTML = recipe.steps.map((step) => renderStep(step, currentScale, recipe.ingredients)).join("");
    renderReviews(recipe.reviews);
    renderSnapshots(recipe.snapshots, snapshotList);
    subIngredient.innerHTML = recipe.ingredients
      .map((item, idx) => `<option value="${idx}">${escapeHtml(item.name)}</option>`)
      .join("");
    scaleHint.textContent =
      currentScale === 1
        ? "Scale 1x: showing grams/ml plus original measurements."
        : `Scale ${currentScale}x: showing scaled metric values only.`;
    wireStepTimers();
  };

  scaleSelect.addEventListener("change", () => {
    currentScale = Number(scaleSelect.value);
    customScale.value = "";
    render();
  });

  applyScale.addEventListener("click", () => {
    const custom = Number(customScale.value);
    if (!custom || custom <= 0) return;
    currentScale = custom;
    scaleSelect.value = "1";
    render();
  });

  cookModeBtn.addEventListener("click", async () => {
    if (!("wakeLock" in navigator)) {
      cookModeBtn.textContent = "Wake lock unavailable";
      return;
    }
    try {
      if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
        cookModeBtn.textContent = "Cook Mode";
      } else {
        wakeLock = await navigator.wakeLock.request("screen");
        cookModeBtn.textContent = "Cook Mode On";
        wakeLock.addEventListener("release", () => {
          cookModeBtn.textContent = "Cook Mode";
          wakeLock = null;
        });
      }
    } catch {
      cookModeBtn.textContent = "Wake lock blocked";
    }
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && wakeLock === null && cookModeBtn.textContent === "Cook Mode On") {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
      } catch {
        cookModeBtn.textContent = "Wake lock blocked";
      }
    }
  });

  printBtn.addEventListener("click", () => window.print());
  editRecipeBtn.addEventListener("click", () => {
    location.href = `add-recipe.html?edit=${encodeURIComponent(recipe.id)}`;
  });

  snapshotBtn.addEventListener("click", () => {
    recipe.snapshots.unshift({
      id: `s_${Date.now()}`,
      createdAt: Date.now(),
      scale: currentScale,
      ingredients: recipe.ingredients.map((x) => ({ ...x })),
      steps: [...recipe.steps],
    });
    saveStore(store);
    render();
  });

  saveReviewBtn.addEventListener("click", async () => {
    const text = reviewText.value.trim();
    if (!text) return;
    const image = await fileToDataUrl(reviewImage.files[0]);
    recipe.reviews.unshift({
      id: String(Date.now()),
      text,
      rating: Number(reviewRating.value),
      image: image || "",
      createdAt: Date.now(),
    });
    saveStore(store);
    reviewText.value = "";
    reviewImage.value = "";
    reviewRating.value = "5";
    render();
  });

  subSuggestBtn.addEventListener("click", () => {
    const idx = Number(subIngredient.value);
    const item = recipe.ingredients[idx];
    if (!item) return;
    const key = Object.keys(substitutionMap).find((k) => item.name.toLowerCase().includes(k));
    const swaps = key ? substitutionMap[key] : ["closest same-role ingredient", "check flavor balance"];
    subResult.innerHTML = `
      <article class="review-card">
        <p><strong>${escapeHtml(item.name)}</strong></p>
        <p>${swaps.map((s) => escapeHtml(s)).join(", ")}</p>
      </article>
    `;
  });

  render();
}

function renderRecipeCards(recipes, target) {
  if (!recipes.length) {
    target.innerHTML = `<div class="empty">No recipes match this view yet.</div>`;
    return;
  }
  target.innerHTML = recipes
    .map(
      (r) => `
      <article class="recipe-card">
        <h3>${escapeHtml(r.title)}</h3>
        <p>${escapeHtml(r.category)}</p>
        <p class="hint">${r.ingredients.length} ingredients</p>
        <a class="btn btn-secondary" href="recipe.html?id=${encodeURIComponent(r.id)}">Open</a>
      </article>
    `,
    )
    .join("");
}

function renderPreview(recipe) {
  return `
    <h3>${escapeHtml(recipe.title)}</h3>
    <p class="hint">${escapeHtml(recipe.category)}</p>
    <p><strong>Ingredients:</strong> ${recipe.ingredients.length}</p>
    <p><strong>Steps:</strong> ${recipe.steps.length}</p>
  `;
}

function renderIngredient(item, scale) {
  const grams = round(item.grams * scale);
  const hasLiquid = item.isLiquid;
  const ml = hasLiquid ? round(item.ml * scale) : null;
  if (scale === 1) {
    const base = hasLiquid
      ? `${grams} g (${ml} ml)`
      : `${grams} g`;
    return `<li><strong>${escapeHtml(item.name)}</strong>: ${base} <span class="original-amount">| original: ${escapeHtml(item.original)}</span></li>`;
  }
  return hasLiquid
    ? `<li><strong>${escapeHtml(item.name)}</strong>: ${grams} g (${ml} ml)</li>`
    : `<li><strong>${escapeHtml(item.name)}</strong>: ${grams} g</li>`;
}

function renderStep(step, scale, ingredients) {
  const normalizedStep = convertFahrenheitTextToCelsius(step);
  const enrichedStep = injectIngredientAmountsIntoStep(normalizedStep, ingredients || [], scale);
  const withTimer = enrichedStep.replace(/(\d+)\s*min/gi, (match, mins) => {
    const scaled = Math.max(1, round(Number(mins) * scale));
    return `${scaled} min <span class="timer-actions"><button class="timer-chip start" type="button" data-minutes="${scaled}">Start ${scaled}m</button> <button class="timer-chip reset" type="button" data-minutes="${scaled}">Reset</button></span>`;
  });
  return `<li class="step-item">${escapeHtmlKeepButtons(withTimer)}</li>`;
}

function wireStepTimers() {
  document.querySelectorAll(".timer-chip.start").forEach((button) => {
    button.addEventListener("click", () => {
      const minutes = Number(button.dataset.minutes);
      startCountdown(button, minutes * 60);
    });
  });
  document.querySelectorAll(".timer-chip.reset").forEach((button) => {
    button.addEventListener("click", () => {
      const minutes = Number(button.dataset.minutes);
      resetCountdown(button, minutes * 60);
    });
  });
}

function startCountdown(button, secondsLeft) {
  clearTimerForButton(button);
  button.disabled = true;
  const tick = () => {
    const m = Math.floor(secondsLeft / 60);
    const s = String(secondsLeft % 60).padStart(2, "0");
    button.textContent = `${m}:${s}`;
    if (secondsLeft === 0) {
      button.textContent = "Done";
      button.disabled = false;
      button.dataset.timerId = "";
      try {
        const audio = new Audio("data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=");
        audio.play();
      } catch {}
      return;
    }
    secondsLeft -= 1;
    const id = setTimeout(tick, 1000);
    button.dataset.timerId = String(id);
  };
  tick();
}

function resetCountdown(resetButton, seconds) {
  const host = resetButton.parentElement;
  if (!host) return;
  const startBtn = host.querySelector(".timer-chip.start");
  if (!startBtn) return;
  clearTimerForButton(startBtn);
  startBtn.disabled = false;
  startBtn.textContent = `Start ${Math.max(1, Math.round(seconds / 60))}m`;
}

function clearTimerForButton(startButton) {
  const timerId = Number(startButton.dataset.timerId || "0");
  if (timerId) clearTimeout(timerId);
  startButton.dataset.timerId = "";
}

function renderReviews(reviews) {
  const reviewList = document.querySelector("#reviewList");
  if (!reviews.length) {
    reviewList.innerHTML = `<div class="empty">No reviews yet.</div>`;
    return;
  }
  reviewList.innerHTML = reviews
    .map((r) => {
      return `
        <article class="review-card">
          <p><strong>Rating:</strong> ${r.rating}/5</p>
          <p>${escapeHtml(r.text)}</p>
          ${r.image ? `<img src="${r.image}" alt="Recipe result photo" />` : ""}
        </article>
      `;
    })
    .join("");
}

function renderSnapshots(snapshots, target) {
  if (!snapshots.length) {
    target.innerHTML = `<div class="empty">No snapshots yet.</div>`;
    return;
  }
  target.innerHTML = snapshots
    .map((snap) => {
      const date = new Date(snap.createdAt).toLocaleString();
      return `
        <article class="review-card">
          <p><strong>${escapeHtml(date)}</strong> | scale ${snap.scale}x</p>
          <p>${snap.ingredients.length} ingredients captured.</p>
        </article>
      `;
    })
    .join("");
}

function parseRecipe(text, category, explicitTitle) {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = explicitTitle || lines[0] || "Untitled Recipe";
  let mode = "intro";
  const ingredientLines = [];
  const steps = [];

  lines.slice(1).forEach((line) => {
    if (/^(ingredients?|what you need)$/i.test(line)) {
      mode = "ing";
      return;
    }
    if (/^(instructions?|directions?|method|steps)$/i.test(line)) {
      mode = "step";
      return;
    }
    if (mode === "ing" || looksLikeIngredient(line)) {
      mode = "ing";
      ingredientLines.push(cleanBullet(line));
      return;
    }
    if (mode === "step" || looksLikeStep(line)) {
      mode = "step";
      steps.push(convertFahrenheitTextToCelsius(cleanBullet(line)));
    }
  });

  const ingredients = ingredientLines.map(toIngredientData);
  return {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    category: category || "Meal",
    ingredients,
    steps: steps.length ? steps : ["Add instructions manually."],
    sourceUrl: "",
    reviews: [],
    snapshots: [],
    createdAt: Date.now(),
    substitutions: collectSubstitutions(ingredients),
  };
}

function toIngredientData(line) {
  const parsed = parseAmount(line);
  const rest = line.replace(parsed.raw, "").trim();
  const name = rest || line;
  const isLiquid = /\b(milk|water|oil|juice|broth|cream)\b/i.test(name);
  const gramsPerUnit = resolveGramsPerUnit(parsed.unit, name);
  const grams = parsed.value * gramsPerUnit;
  const ml = isLiquid ? parsed.value * resolveMlPerUnit(parsed.unit) : 0;
  return {
    name,
    original: line,
    grams: Math.max(1, round(grams)),
    ml: Math.max(0, round(ml)),
    isLiquid,
  };
}

function parseAmount(line) {
  const match = line.match(/^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/);
  if (!match) return { value: 1, unit: "unit", raw: "" };
  return {
    value: numberFromText(match[1]),
    unit: (match[2] || "unit").toLowerCase(),
    raw: match[0],
  };
}

function resolveGramsPerUnit(unit, ingredientName) {
  const u = unit.toLowerCase();
  if (u.startsWith("cup")) {
    if (/\bflour\b/i.test(ingredientName)) return 120;
    if (/\bsugar\b/i.test(ingredientName)) return 200;
    if (/\boil\b/i.test(ingredientName)) return 216;
    if (/\bmilk|water|juice|broth|cream\b/i.test(ingredientName)) return 240;
    return 180;
  }
  if (u.startsWith("tbsp")) return 15;
  if (u.startsWith("tsp")) return 5;
  if (u === "g" || u === "gram" || u === "grams") return 1;
  if (u === "kg") return 1000;
  if (u === "ml") return 1;
  if (u === "l") return 1000;
  if (u === "oz") return 28.35;
  return 50;
}

function resolveMlPerUnit(unit) {
  const u = unit.toLowerCase();
  if (u.startsWith("cup")) return 240;
  if (u.startsWith("tbsp")) return 15;
  if (u.startsWith("tsp")) return 5;
  if (u === "ml") return 1;
  if (u === "l") return 1000;
  if (u === "oz") return 29.57;
  return 0;
}

function collectSubstitutions(ingredients) {
  const lines = [];
  ingredients.forEach((item) => {
    const key = Object.keys(substitutionMap).find((k) => item.name.toLowerCase().includes(k));
    if (key) lines.push(`${item.name}: ${substitutionMap[key].join(", ")}`);
  });
  return lines;
}

function looksLikeIngredient(line) {
  return /^[-*]?\s*(\d|one|two|three|four|five)\b/i.test(line);
}

function looksLikeStep(line) {
  return /\b(preheat|mix|whisk|stir|bake|cook|fold|simmer|chop|add|beat|serve|rest)\b/i.test(line);
}

function cleanBullet(line) {
  return line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
}

function numberFromText(text) {
  return text.split(/\s+/).reduce((sum, token) => {
    if (token.includes("/")) {
      const [a, b] = token.split("/").map(Number);
      return sum + a / b;
    }
    return sum + Number(token);
  }, 0);
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body?.innerText || "";
}

function findTitleFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector("title")?.textContent?.trim() || "";
}

function fileToDataUrl(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function escapeHtmlKeepButtons(raw) {
  const token = "__BTN__";
  const pieces = [];
  const replaced = raw.replace(/<button[^>]*>.*?<\/button>/g, (btn) => {
    pieces.push(btn);
    return token;
  });
  let escaped = escapeHtml(replaced);
  pieces.forEach((btn) => {
    escaped = escaped.replace(token, btn);
  });
  return escaped;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function ingredientMeasureText(item, scale) {
  const grams = round(item.grams * scale);
  if (item.isLiquid) {
    const ml = round(item.ml * scale);
    return `${grams} g / ${ml} ml`;
  }
  return `${grams} g`;
}

function injectIngredientAmountsIntoStep(step, ingredients, scale) {
  let result = step;
  const sorted = [...ingredients].sort((a, b) => b.name.length - a.name.length);
  sorted.forEach((item) => {
    const name = (item.name || "").trim();
    if (!name || name.length < 2) return;
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    if (pattern.test(result)) {
      result = result.replace(pattern, `${name} (${ingredientMeasureText(item, scale)})`);
    }
  });
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function convertFahrenheitTextToCelsius(line) {
  return line
    .replace(/(\d+(?:\.\d+)?)\s*°?\s*F\b/gi, (match, f) => `${Math.round(((Number(f) - 32) * 5) / 9)}C`)
    .replace(/(\d+(?:\.\d+)?)\s*degrees?\s*fahrenheit\b/gi, (match, f) => `${Math.round(((Number(f) - 32) * 5) / 9)}C`);
}

function buildRecipeFromEditors({ title, category, ingredientsText, stepsText, sourceText }) {
  const ingredientLines = ingredientsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const stepLines = stepsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(convertFahrenheitTextToCelsius);
  const ingredients = ingredientLines.map(toIngredientData);
  return {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: title || "Untitled Recipe",
    category: category || "Meal",
    ingredients,
    steps: stepLines.length ? stepLines : ["Add instructions manually."],
    sourceUrl: "",
    sourceText: sourceText || "",
    reviews: [],
    snapshots: [],
    createdAt: Date.now(),
    substitutions: collectSubstitutions(ingredients),
  };
}

async function analyzeRecipeWithGemini(rawText) {
  if (location.protocol === "file:") {
    throw new Error("Gemini calls are blocked from file:// origin");
  }
  const cfg = getSyncConfig();
  if (!cfg.geminiApiKey) {
    throw new Error("Missing Gemini API key");
  }

  const prompt = [
    "You are a recipe parser.",
    "Return JSON only with keys: title, category, ingredients, steps.",
    "All output must be in English.",
    "Category must be one of: Meal, Dessert, Breakfast, Snack, Soup, Salad, Bread, Drink.",
    "ingredients must be an array of strings.",
    "steps must be an array of strings.",
    "All temperatures in steps must be in Celsius only (e.g. 180C).",
    "Recipe text:",
    rawText,
  ].join("\n");

  const GEMINI_API_KEY = cfg.geminiApiKey;
  const apiBase = "https://generativelanguage.googleapis.com";
  const versions = ["v1", "v1beta"];
  let lastError = "Unknown Gemini error";

  for (const version of versions) {
    try {
      const selectedModel = await resolveAvailableGeminiModel(apiBase, GEMINI_API_KEY, version);
      const url = `${apiBase}/${version}/models/${selectedModel}:generateContent?key=${GEMINI_API_KEY}`;
      console.log("Full URL:", url.replace(GEMINI_API_KEY, "SECRET"));
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        lastError = `${version} ${response.status} ${errText}`;
        continue;
      }
      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = `${version} returned empty content`;
        continue;
      }
      const parsed = safeParseJson(text);
      if (!parsed) {
        lastError = `${version} returned invalid JSON`;
        continue;
      }
      return {
        title: String(parsed.title || "").trim(),
        category: String(parsed.category || "Meal").trim(),
        ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients.map((x) => String(x).trim()).filter(Boolean) : [],
        steps: Array.isArray(parsed.steps) ? parsed.steps.map((x) => String(x).trim()).filter(Boolean) : [],
      };
    } catch (err) {
      lastError = err.message || String(err);
    }
  }
  throw new Error(lastError);
}

async function resolveAvailableGeminiModel(apiBase, apiKey, version) {
  const preferred = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash"];
  const listUrl = `${apiBase}/${version}/models?key=${apiKey}`;
  const listResponse = await fetch(listUrl, { method: "GET" });
  if (!listResponse.ok) {
    const errText = await listResponse.text();
    throw new Error(`ListModels ${version} failed: ${listResponse.status} ${errText}`);
  }
  const payload = await listResponse.json();
  const models = Array.isArray(payload.models) ? payload.models : [];
  const supported = models
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter(Boolean);

  for (const wanted of preferred) {
    if (supported.includes(wanted)) return wanted;
  }
  if (supported.length) return supported[0];
  throw new Error("No generateContent model is available for this API key/project.");
}

async function saveRecipeToFirestore(recipe) {
  const cfg = getSyncConfig();
  if (!cfg.firebaseProjectId || !cfg.firebaseApiKey) {
    throw new Error("Missing Firebase project configuration");
  }
  const endpoint =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.firebaseProjectId)}` +
    `/databases/(default)/documents/recipes/${encodeURIComponent(recipe.id)}?key=${encodeURIComponent(cfg.firebaseApiKey)}`;

  const doc = {
    fields: {
      id: { stringValue: recipe.id },
      title: { stringValue: recipe.title },
      category: { stringValue: recipe.category },
      sourceUrl: { stringValue: recipe.sourceUrl || "" },
      sourceText: { stringValue: recipe.sourceText || "" },
      createdAt: { integerValue: String(recipe.createdAt) },
      updatedAt: { integerValue: String(Date.now()) },
      ingredientsJson: { stringValue: JSON.stringify(recipe.ingredients) },
      stepsJson: { stringValue: JSON.stringify(recipe.steps) },
      substitutionsJson: { stringValue: JSON.stringify(recipe.substitutions || []) },
    },
  };

  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!response.ok) {
    throw new Error("Firestore save failed");
  }
  return response.json();
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const block = text.match(/\{[\s\S]*\}/);
    if (!block) return null;
    try {
      return JSON.parse(block[0]);
    } catch {
      return null;
    }
  }
}

async function fetchRecipeTextFromUrl(url) {
  const attempts = [
    async () => {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      return htmlToText(html);
    },
    async () => {
      const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
      return await res.text();
    },
  ];

  let lastError = "Unknown import error";
  for (const attempt of attempts) {
    try {
      const text = await attempt();
      if (text && text.trim().length > 20) return text;
      lastError = "Imported content was empty";
    } catch (err) {
      lastError = err.message || String(err);
    }
  }
  throw new Error(lastError);
}

function guessTitleFromText(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 4 && line.length < 80);
}

function getSyncConfig() {
  const raw = window.RECIPE_SYNC || {};
  return { ...DEFAULT_SYNC_CONFIG, ...raw };
}

function isSyncEnabled() {
  const cfg = getSyncConfig();
  return Boolean(cfg.enabled && cfg.supabaseUrl && cfg.anonKey);
}

function syncHeaders() {
  const cfg = getSyncConfig();
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    "Content-Type": "application/json",
  };
}

async function hydrateFromCloud() {
  if (!isSyncEnabled()) return;
  const cloudStore = await pullCloudStore();
  if (cloudStore && Array.isArray(cloudStore.recipes)) {
    localStorage.setItem(APP_KEY, JSON.stringify(cloudStore));
  }
}

function queueCloudSave(store) {
  if (!isSyncEnabled()) return;
  pushCloudStore(store).catch(() => {});
}

async function pullCloudStore() {
  const cfg = getSyncConfig();
  const url = `${cfg.supabaseUrl}/rest/v1/${cfg.table}?id=eq.${encodeURIComponent(cfg.rowId)}&select=payload&limit=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: syncHeaders(),
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data) || !data[0] || !data[0].payload) return null;
  return data[0].payload;
}

async function pushCloudStore(store) {
  const cfg = getSyncConfig();
  const url = `${cfg.supabaseUrl}/rest/v1/${cfg.table}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...syncHeaders(),
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([
      {
        id: cfg.rowId,
        payload: store,
        updated_at: new Date().toISOString(),
      },
    ]),
  });
  return response.ok;
}

function setupSyncControls() {
  const statusNode = document.querySelector("#syncStatus");
  const pullBtn = document.querySelector("#pullCloudBtn");
  const pushBtn = document.querySelector("#pushCloudBtn");
  if (!statusNode || !pullBtn || !pushBtn) return;

  const setStatus = (msg) => {
    statusNode.textContent = msg;
  };

  if (!isSyncEnabled()) {
    setStatus("Cloud sync is disabled. Fill sync-config.js to connect Supabase.");
    pullBtn.disabled = true;
    pushBtn.disabled = true;
    return;
  }

  setStatus("Cloud sync connected. Local changes are auto-pushed.");

  pullBtn.addEventListener("click", async () => {
    setStatus("Pulling data from cloud...");
    try {
      const cloud = await pullCloudStore();
      if (!cloud) {
        setStatus("No cloud data found yet.");
        return;
      }
      localStorage.setItem(APP_KEY, JSON.stringify(cloud));
      setStatus("Cloud data pulled successfully. Reloading...");
      location.reload();
    } catch {
      setStatus("Cloud pull failed.");
    }
  });

  pushBtn.addEventListener("click", async () => {
    setStatus("Pushing local data to cloud...");
    try {
      await pushCloudStore(loadStore());
      setStatus("Cloud push completed.");
    } catch {
      setStatus("Cloud push failed.");
    }
  });
}
