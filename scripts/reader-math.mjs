const greekLetters = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  sigma: "σ", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const symbols = {
  times: "×", cdot: "⋅", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥",
  neq: "≠", approx: "≈", sim: "∼", infty: "∞", propto: "∝", to: "→", rightarrow: "→",
  leftarrow: "←", Leftrightarrow: "⇔", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫",
  lesssim: "≲", gtrsim: "≳", simeq: "≃", perp: "⟂", in: "∈", notin: "∉",
  odot: "⊙", ell: "ℓ", bullet: "•", circ: "○", ast: "∗", degree: "°",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function node(tag, children = [], attributes = {}) {
  return { tag, children, attributes };
}

function textNode(tag, value, attributes = {}) {
  return node(tag, [{ text: String(value) }], attributes);
}

function renderNode(value) {
  if (value?.text !== undefined) return escapeHtml(value.text);
  const attributes = Object.entries(value.attributes ?? {})
    .map(([key, attribute]) => ` ${key}="${escapeHtml(attribute)}"`)
    .join("");
  return `<${value.tag}${attributes}>${value.children.map(renderNode).join("")}</${value.tag}>`;
}

function wrap(children) {
  return children.length === 1 ? children[0] : node("mrow", children);
}

function mathText(value) {
  return textNode("mtext", value);
}

function parseTex(source) {
  const input = String(source);
  let index = 0;

  function skipWhitespace() {
    while (/\s/u.test(input[index] ?? "")) index += 1;
  }

  function parseSequence(stopAtBrace = false) {
    const children = [];
    while (index < input.length) {
      if (input[index] === "}") {
        if (stopAtBrace) break;
        children.push(textNode("mo", "}"));
        index += 1;
        continue;
      }
      if (/\s/u.test(input[index])) {
        skipWhitespace();
        if (children.length > 0 && index < input.length) children.push(node("mspace", [], { width: "0.2em" }));
        continue;
      }
      children.push(parseAtomWithScripts());
    }
    return children;
  }

  function parseGroup() {
    if (input[index] !== "{") return parseAtomWithScripts();
    index += 1;
    const children = parseSequence(true);
    if (input[index] === "}") index += 1;
    return wrap(children);
  }

  function parseArgument() {
    skipWhitespace();
    return input[index] === "{" ? parseGroup() : parseAtomWithScripts();
  }

  function parseCommand() {
    index += 1;
    if (index >= input.length) return mathText("\\");
    const commandStart = index;
    while (/[A-Za-z]/u.test(input[index] ?? "")) index += 1;
    const command = index > commandStart ? input.slice(commandStart, index) : input[index++];
    if (["frac", "dfrac", "tfrac", "cfrac"].includes(command)) {
      return node("mfrac", [parseArgument(), parseArgument()]);
    }
    if (command === "sqrt") return node("msqrt", [parseArgument()]);
    if (["mathrm", "textrm", "rm", "mathbf", "textbf", "mathit", "textit", "mathcal", "cal", "mathbb", "mathsf", "texttt"].includes(command)) {
      const variants = {
        mathcal: "script",
        cal: "script",
        mathbb: "double-struck",
        mathsf: "sans-serif",
        texttt: "monospace",
      };
      const variant = variants[command] ?? (["mathbf", "textbf"].includes(command) ? "bold" : ["mathit", "textit"].includes(command) ? "italic" : "normal");
      return node("mrow", [parseArgument()], { mathvariant: variant });
    }
    if (["text", "operatorname"].includes(command)) return node("mtext", [parseArgument()]);
    if (["hat", "widehat", "bar", "vec", "dot", "tilde"].includes(command)) {
      const accents = { hat: "^", widehat: "^", bar: "¯", vec: "→", dot: "˙", tilde: "˜" };
      return node("mover", [parseArgument(), textNode("mo", accents[command])]);
    }
    if (["log", "ln", "exp", "sin", "cos", "tan", "max", "min"].includes(command)) {
      return textNode("mo", command);
    }
    if (greekLetters[command]) return textNode("mi", greekLetters[command]);
    if (symbols[command]) {
      const operator = symbols[command];
      return textNode("mo", operator, ["sum", "prod", "int"].includes(command) ? { largeop: "true" } : {});
    }
    if (command === "left" || command === "right") {
      skipWhitespace();
      const delimiter = input[index] ?? "";
      index += 1;
      return textNode("mo", delimiter === "." ? "" : delimiter);
    }
    if (command === "quad" || command === "!" || command === "," || command === ";") {
      return node("mspace", [], { width: command === "quad" ? "1em" : "0.2em" });
    }
    return mathText(`\\${command}`);
  }

  function parseAtom() {
    if (input[index] === "{") return parseGroup();
    if (input[index] === "\\") return parseCommand();
    const character = input[index++];
    if (/[0-9]/u.test(character)) {
      let value = character;
      while (/[0-9.,]/u.test(input[index] ?? "")) value += input[index++];
      return textNode("mn", value);
    }
    if (/[A-Za-z]/u.test(character)) return textNode("mi", character);
    return textNode("mo", character);
  }

  function parseAtomWithScripts() {
    const base = parseAtom();
    let subscript = null;
    let superscript = null;
    while (input[index] === "_" || input[index] === "^") {
      const marker = input[index++];
      const argument = parseArgument();
      if (marker === "_") subscript = argument;
      else superscript = argument;
    }
    if (subscript && superscript) return node("msubsup", [base, subscript, superscript]);
    if (subscript) return node("msub", [base, subscript]);
    if (superscript) return node("msup", [base, superscript]);
    return base;
  }

  return wrap(parseSequence());
}

function findClosing(source, start, closing) {
  let cursor = start;
  while (cursor < source.length) {
    const found = source.indexOf(closing, cursor);
    if (found === -1) return -1;
    let backslashes = 0;
    for (let index = found - 1; index >= 0 && source[index] === "\\"; index -= 1) backslashes += 1;
    if (backslashes % 2 === 0) return found;
    cursor = found + closing.length;
  }
  return -1;
}

export function splitMath(value) {
  const source = String(value);
  const segments = [];
  let textStart = 0;
  let cursor = 0;
  const addText = (end) => {
    if (end > textStart) segments.push({ kind: "text", value: source.slice(textStart, end) });
  };

  while (cursor < source.length) {
    const candidates = [
      { delimiter: "$$", closing: "$$", display: true },
      { delimiter: "\\[", closing: "\\]", display: true },
      { delimiter: "\\(", closing: "\\)", display: false },
      { delimiter: "$", closing: "$", display: false },
    ]
      .map((candidate) => ({ ...candidate, start: source.indexOf(candidate.delimiter, cursor) }))
      .filter((candidate) => candidate.start !== -1)
      .sort((left, right) => left.start - right.start);
    const candidate = candidates[0];
    if (!candidate) break;
    if (candidate.delimiter === "$" && source[candidate.start + 1] === "$") {
      cursor = candidate.start + 2;
      continue;
    }
    const contentStart = candidate.start + candidate.delimiter.length;
    const closing = findClosing(source, contentStart, candidate.closing);
    if (closing === -1 || closing === contentStart || source.slice(contentStart, closing).includes("\n")) {
      cursor = contentStart;
      continue;
    }
    addText(candidate.start);
    segments.push({ kind: "math", value: source.slice(contentStart, closing).trim(), display: candidate.display });
    cursor = closing + candidate.closing.length;
    textStart = cursor;
  }
  addText(source.length);
  return segments.length > 0 ? segments : [{ kind: "text", value: source }];
}

export function renderMathMarkup(value, display = false) {
  const source = String(value).trim();
  const body = renderNode(parseTex(source));
  const displayAttribute = display ? ' display="block"' : "";
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${displayAttribute} aria-label="${escapeHtml(source)}"><semantics>${body}<annotation encoding="application/x-tex">${escapeHtml(source)}</annotation></semantics></math>`;
}
