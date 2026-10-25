export function createToggleRow(label, checked, onChange) {
  const row = document.createElement("div");
  row.className = "toggle-row";
  const labelEl = document.createElement("span");
  labelEl.className = "toggle-label";
  labelEl.textContent = label;
  const toggleSwitch = document.createElement("label");
  toggleSwitch.className = "toggle-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", (e) => {
    onChange(e.target.checked);
  });
  const slider = document.createElement("span");
  slider.className = "toggle-slider";
  toggleSwitch.appendChild(input);
  toggleSwitch.appendChild(slider);
  row.appendChild(labelEl);
  row.appendChild(toggleSwitch);
  return row;
}

export function createSliderRow(label, value, min, max, step, onChange) {
  const row = document.createElement("div");
  row.className = "toggle-row";
  row.classList.add("panel-range-row");
  const topRow = document.createElement("div");
  topRow.className = "panel-range-heading";
  const labelEl = document.createElement("span");
  labelEl.className = "toggle-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "toggle-label";
  valueEl.classList.add("panel-range-value");
  valueEl.textContent = value;
  topRow.appendChild(labelEl);
  topRow.appendChild(valueEl);
  const sliderContainer = document.createElement("div");
  sliderContainer.className = "panel-range-track";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = value;
  slider.className = "panel-slider-input";
  const percentage = ((value - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, #0078d4 0%, #0078d4 ${percentage}%, #dfe7ef ${percentage}%, #dfe7ef 100%)`;

  slider.addEventListener("input", (e) => {
    const newValue = parseInt(e.target.value);
    valueEl.textContent = newValue;
    const newPercentage = ((newValue - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, #0078d4 0%, #0078d4 ${newPercentage}%, #dfe7ef ${newPercentage}%, #dfe7ef 100%)`;
    onChange(newValue);
  });
  sliderContainer.appendChild(slider);
  row.appendChild(topRow);
  row.appendChild(sliderContainer);
  return row;
}

export function createSelectRow(label, options, selectedValue, onChange) {
  const row = document.createElement("div");
  row.className = "toggle-row";
  const labelEl = document.createElement("span");
  labelEl.className = "toggle-label";
  labelEl.textContent = label;
  const selectWrapper = document.createElement("div");
  selectWrapper.className = "panel-select-wrapper";
  const select = document.createElement("select");
  select.className = "panel-select-input";
  select.addEventListener("mouseenter", () => {
    select.style.background = "#f8fbfe";
    select.style.borderColor = "#9cc9e7";
  });
  select.addEventListener("mouseleave", () => {
    if (document.activeElement !== select) {
      select.style.background = "#fff";
      select.style.borderColor = "#cbd5df";
    }
  });
  select.addEventListener("focus", () => {
    select.style.background = "#f8fbfe";
    select.style.borderColor = "#70b7e4";
    select.style.boxShadow = "0 0 0 2px rgba(0, 120, 212, 0.15)";
  });
  select.addEventListener("blur", () => {
    select.style.background = "#fff";
    select.style.borderColor = "#cbd5df";
    select.style.boxShadow = "none";
  });
  const arrow = document.createElement("span");
  arrow.innerHTML = "▼";
  arrow.className = "panel-select-arrow";
  options.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = opt.value === selectedValue;
    option.className = "panel-select-option";
    select.appendChild(option);
  });
  select.addEventListener("change", (e) => {
    onChange(e.target.value);
  });
  selectWrapper.appendChild(select);
  selectWrapper.appendChild(arrow);
  row.appendChild(labelEl);
  row.appendChild(selectWrapper);
  return row;
}

export function createInnerCollapsibleSection(title, contentNode, collapsed = true, headerControl = null) {
  const wrapper = document.createElement("div");
  wrapper.className = `settings-inner-collapsible${collapsed ? " collapsed" : ""}`;
  const header = document.createElement("div");
  header.className = "settings-inner-collapsible-header";
  const titleElement = document.createElement("span");
  titleElement.textContent = title;
  const collapseIcon = document.createElement("span");
  collapseIcon.className = "collapse-icon";
  collapseIcon.setAttribute("aria-hidden", "true");
  header.appendChild(titleElement);
  if (headerControl) {
    const controls = document.createElement("span");
    controls.className = "settings-inner-collapsible-controls";
    headerControl.addEventListener("click", (event) => event.stopPropagation());
    controls.appendChild(headerControl);
    controls.appendChild(collapseIcon);
    header.appendChild(controls);
  } else {
    header.appendChild(collapseIcon);
  }
  const body = document.createElement("div");
  body.className = "settings-inner-collapsible-content";
  if (contentNode) body.appendChild(contentNode);
  header.addEventListener("click", () => wrapper.classList.toggle("collapsed"));
  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}
