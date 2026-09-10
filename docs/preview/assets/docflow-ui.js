// Static evidence explorer. This does not call a model or infer architecture facts.
const preset = getComputedStyle(document.documentElement)
  .getPropertyValue("--doc-design")
  .trim();
const reading = preset === "reading";
const enabled = reading || preset === "architecture";
if (enabled) {
  const main = document.querySelector("main"),
    nav = document.querySelector('nav[aria-label="문서 메뉴"]');
  const element = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const labels = {
    fresh: "검토 기준과 코드가 일치합니다",
    stale: "관련 코드가 변경되어 재검토가 필요합니다",
    missing: "원본 또는 코드 근거가 누락됐습니다",
    unreviewed: "검토가 필요합니다",
  };
  if (main && nav) {
    const header = element("header", "atlas-header");
    const brand = element("a", "atlas-brand");
    brand.href = nav.querySelector("a").href;
    brand.append(
      element("span", "atlas-mark", "⌘"),
      element("span", "", reading ? "개발자 문서" : "Architecture Intelligence"),
    );
    header.append(
      brand,
      element("span", "atlas-header-label", "CODE → MODEL → DOCUMENT"),
    );
    const shell = element("div", "atlas-shell"),
      sidebar = element("aside", "atlas-sidebar");
    sidebar.setAttribute("aria-label", "문서 탐색");
    sidebar.append(
      element("span", "atlas-section-label", reading ? "문서" : "EXPLORE"),
      nav,
    );
    const outline = element("nav", "atlas-outline");
    outline.setAttribute("aria-label", "현재 페이지 목차");
    outline.append(
      element(
        "span",
        "atlas-section-label",
        reading ? "이 페이지에서" : "ON THIS PAGE",
      ),
    );
    main.querySelectorAll("h2").forEach((heading, i) => {
      heading.id ||= `section-${i}`;
      const link = element("a", "", heading.textContent);
      link.href = "#" + heading.id;
      outline.append(link);
    });
    if (!reading) sidebar.append(outline);
    const rail = element("aside", "atlas-evidence");
    rail.id = "source-evidence";
    rail.setAttribute("aria-label", "코드 근거와 검토 정보");
    rail.append(
      element("h2", "", "SOURCE EVIDENCE"),
      element("p", "", "근거 정보를 불러오는 중입니다."),
    );
    main.before(header, shell);
    if (reading) {
      const toc = element("aside", "reading-toc");
      const fold = element("details");
      fold.open = !matchMedia("(max-width: 1100px)").matches;
      fold.append(element("summary", "", "이 페이지 목차"), outline);
      toc.append(fold);
      shell.append(sidebar, main, toc);
      main.append(rail);
      const sourceLink = element("a", "", "코드 근거와 검토 기록");
      sourceLink.href = "#source-evidence";
      outline.append(sourceLink);
    } else shell.append(sidebar, main, rail);
    const hero = element("section", "atlas-hero");
    hero.setAttribute("aria-label", "문서 상태");
    const title = main.querySelector("h1");
    hero.append(
      element(
        "p",
        "atlas-eyebrow",
        reading ? "개발자 가이드" : "OMM / ARCHITECTURE INTELLIGENCE",
      ),
    );
    if (title) hero.append(title);
    const status = element(
      "div",
      "atlas-status",
      "근거 상태를 확인하고 있습니다.",
    );
    status.setAttribute("role", "status");
    hero.append(status);
    main.prepend(hero);
    const evidenceLink = element(
      "a",
      "atlas-evidence-link",
      "근거 파일 찾기 →",
    );
    evidenceLink.href = "#source-evidence";
    hero.append(evidenceLink);
    const stats = element("div", "atlas-stats");
    hero.append(stats);
    const stat = (value, label, unit = "") => {
      const card = element("div", "atlas-stat");
      card.append(
        element("small", "", label),
        element("strong", "", String(value)),
      );
      if (unit) card.append(element("span", "", unit));
      stats.append(card);
    };
    const attachBlueprint = () => {
      const diagram = main.querySelector(".mermaid");
      const svg = diagram?.querySelector("svg");
      if (!svg) return false;
      const panel = element("section", "atlas-blueprint");
      panel.id = "system-blueprint";
      panel.setAttribute("aria-label", "주요 구조도");
      const bar = element("div", "atlas-blueprint-heading");
      bar.append(
        element("span", "", "SYSTEM BLUEPRINT"),
        element("span", "", "그림을 눌러 확대하세요"),
      );
      const search = element("label", "atlas-graph-search");
      const input = element("input");
      input.type = "search";
      input.placeholder = "구조도에서 요소 찾기";
      input.setAttribute("aria-label", "구조도에서 요소 찾기");
      const output = element("output", "", "");
      output.setAttribute("aria-live", "polite");
      search.append(input, output);
      input.addEventListener("input", () => {
        const currentSvg = diagram.querySelector("svg");
        if (!currentSvg) return;
        const term = input.value.trim().toLocaleLowerCase();
        const nodes = [...currentSvg.querySelectorAll(".node")];
        let count = 0;
        nodes.forEach((n) => {
          const match =
            !!term && n.textContent.toLocaleLowerCase().includes(term);
          n.classList.toggle("atlas-node-match", match);
          if (match) count++;
        });
        currentSvg.classList.toggle("atlas-search-active", !!term);
        output.textContent = term ? `${count}개 요소 일치` : "";
      });
      const origin = element("p", "atlas-diagram-origin");
      const link = element("a", "", "위의 주요 구조도 보기 ↑");
      link.href = "#system-blueprint";
      origin.append(link);
      if (reading) {
        diagram.before(panel);
        bar.firstChild.textContent = "구조도";
      } else {
        diagram.before(origin);
        hero.after(panel);
      }
      panel.append(bar, search, diagram);
      return true;
    };
    if (!attachBlueprint()) {
      const observer = new MutationObserver(() => {
        if (attachBlueprint()) observer.disconnect();
      });
      observer.observe(main, { childList: true, subtree: true });
    }
    if (reading) {
      const searchButton = element(
        "button",
        "reading-search-button",
        "문서 찾기",
      );
      searchButton.type = "button";
      searchButton.append(element("kbd", "", "Ctrl / ⌘ K"));
      header.append(searchButton);
      const searchDialog = element("dialog", "reading-search-dialog");
      searchDialog.setAttribute("aria-labelledby", "reading-search-title");
      const searchTitle = element("h2", "", "문서 찾기");
      searchTitle.id = "reading-search-title";
      const field = element("input");
      field.type = "search";
      field.setAttribute("aria-label", "문서 제목과 현재 페이지 목차 검색");
      const matches = element("div", "reading-search-results");
      const matchCount = element("p");
      matchCount.setAttribute("aria-live", "polite");
      const close = element("button", "", "닫기");
      close.type = "button";
      searchDialog.append(
        searchTitle,
        element(
          "p",
          "",
          "탐색 메뉴의 문서 제목과 현재 페이지 목차를 검색합니다.",
        ),
        field,
        matchCount,
        matches,
        close,
      );
      document.body.append(searchDialog);
      const choices = [
        ...nav.querySelectorAll("a"),
        ...outline.querySelectorAll("a"),
      ].map((link) => ({ title: link.textContent.trim(), href: link.href }));
      const search = () => {
        const term = field.value.trim().toLocaleLowerCase();
        const found = choices.filter((x) =>
          x.title.toLocaleLowerCase().includes(term),
        );
        matches.replaceChildren();
        matchCount.textContent = `${found.length}개 결과`;
        for (const choice of found) {
          const link = element("a", "", choice.title);
          link.href = choice.href;
          link.addEventListener("click", () => searchDialog.close());
          matches.append(link);
        }
      };
      const openSearch = () => {
        if (document.querySelector("dialog[open]")) return;
        searchDialog.showModal();
        search();
        field.focus();
      };
      searchButton.addEventListener("click", openSearch);
      field.addEventListener("input", search);
      close.addEventListener("click", () => searchDialog.close());
      searchDialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          searchDialog.close();
        }
      });
      searchDialog.addEventListener("close", () =>
        searchButton.focus({ preventScroll: true }),
      );
      document.addEventListener("keydown", (event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          openSearch();
        }
      });
      const links = [...nav.querySelectorAll("a")];
      const normalize = (url) =>
        new URL(url).pathname.replace(/\/index\.html$/, "/");
      const current = links.findIndex(
        (link) => normalize(link.href) === normalize(location.href),
      );
      const pagination = element("nav", "reading-pagination");
      pagination.setAttribute("aria-label", "이전 문서와 다음 문서");
      for (const [offset, label] of [
        [-1, "← 이전"],
        [1, "다음 →"],
      ]) {
        const target = current >= 0 ? links[current + offset] : null;
        if (!target) continue;
        const link = element(
          "a",
          "",
          `${label} · ${target.textContent.trim()}`,
        );
        link.href = target.href;
        pagination.append(link);
      }
      if (pagination.childElementCount) main.append(pagination);
    }
    try {
      const response = await fetch(
        new URL("docflow-evidence.json", import.meta.url),
      );
      if (!response.ok) throw Error("Evidence unavailable");
      const data = await response.json();
      if (data.schema !== 1) throw Error("Unsupported evidence schema");
      brand.lastChild.textContent = data.project;
      const siteRoot = new URL("../", import.meta.url).pathname;
      const relativePath = location.pathname.startsWith(siteRoot)
        ? location.pathname.slice(siteRoot.length)
        : location.pathname.replace(/^\//, "");
      const page = decodeURIComponent(relativePath || "index.html");
      const record = data.pages[page] ?? data.projectEvidence;
      const scope = Object.hasOwn(data.pages, page)
        ? "이 페이지"
        : "프로젝트 전체";
      status.textContent = labels[record.status] ?? labels.unreviewed;
      status.dataset.state = record.status;
      hero.insertBefore(
        element(
          "p",
          "atlas-scope",
          scope === "이 페이지"
            ? "이 페이지에 연결된 코드 근거와 검토 기록입니다."
            : "프로젝트 전체의 집계입니다. 이 안내 페이지 자체의 검토 상태는 포함하지 않습니다.",
        ),
        stats,
      );
      stat(record.files.length, "SOURCE FILES", "개");
      stat(record.sourceGroups.length, "MODEL VIEWS", "개");
      stat(`${record.reviewedCount}/${record.reviewCount}`, "REVIEWED ITEMS");
      rail.replaceChildren(
        element(
          "h2",
          "",
          reading ? "코드 근거와 검토 기록" : "SOURCE EVIDENCE",
        ),
      );
      if (reading) {
        const scopeInfo = hero.querySelector(".atlas-scope");
        rail.append(scopeInfo, stats);
        const date = element(
          "span",
          "reading-review-date",
          record.reviewedAt
            ? `검토 기록 ${record.reviewedAt}`
            : "검토 기록 없음",
        );
        status.after(date);
      }
      const dl = element("dl");
      const detail = (name, value) => {
        dl.append(element("dt", "", name), element("dd", "", value));
      };
      detail(reading ? "집계 범위" : "SCOPE", scope);
      detail(
        reading ? "검토 기록" : "REVIEWED",
        record.reviewedAt ?? "검토 기록 없음",
      );
      detail(
        reading ? "검토 기준 커밋" : "CODE REVISION",
        record.reviewedCommits.join(" · ") || "검토 기준 없음",
      );
      detail(reading ? "근거 유형" : "EVIDENCE LEVEL", "코드 근거와 검토 기록");
      rail.append(dl);
      rail.append(
        element("h3", "", reading ? "연결된 구조 관점" : "SOURCE GROUPS"),
      );
      for (const group of record.sourceGroups) {
        const p = element("p");
        p.append(
          element("code", "", group.id),
          element("span", "", ` · ${group.fileCount}개`),
        );
        rail.append(p);
      }
      rail.append(element("h3", "", reading ? "근거 파일" : "FIND SOURCE"));
      const input = element("input");
      input.type = "search";
      input.placeholder = "파일명 또는 경로";
      input.setAttribute("aria-label", "근거 파일 검색");
      const results = element("ul", "atlas-files"),
        count = element("p");
      count.setAttribute("aria-live", "polite");
      const more = element("button", "", "더 보기");
      more.type = "button";
      let limit = 5;
      const render = () => {
        const query = input.value.trim().toLocaleLowerCase();
        const files = record.files.filter((f) =>
          f.toLocaleLowerCase().includes(query),
        );
        results.replaceChildren();
        for (const file of files.slice(0, limit)) {
          const item = element("li");
          const name = file.split("/").pop();
          const canLink =
            data.sourceWebUrl &&
            /^https:\/\//.test(data.sourceWebUrl) &&
            record.status === "fresh" &&
            record.reviewedCommits.length === 1 &&
            /^[a-f0-9]{7,40}$/i.test(record.reviewedCommits[0]);
          const label = element(canLink ? "a" : "strong", "", name);
          if (canLink) {
            label.href =
              data.sourceWebUrl +
              "/blob/" +
              record.reviewedCommits[0] +
              "/" +
              file.split("/").map(encodeURIComponent).join("/");
            label.target = "_blank";
            label.rel = "noopener noreferrer";
          }
          item.append(label, element("small", "", file));
          results.append(item);
        }
        count.textContent = `${files.length}개 중 ${Math.min(limit, files.length)}개 표시`;
        more.hidden = files.length <= limit;
      };
      input.addEventListener("input", () => {
        limit = 5;
        render();
      });
      more.addEventListener("click", () => {
        limit += 10;
        render();
      });
      rail.append(input, results, count, more);
      render();
      if (data.changes?.files?.length) {
        rail.append(
          element("h3", "", "COLLECTED CODE CHANGES"),
          element(
            "p",
            "",
            `${data.changes.baseCommit.slice(0, 7)} → ${data.changes.headCommit.slice(0, 7)}`,
          ),
        );
        for (const change of data.changes.files.slice(0, 5))
          rail.append(element("p", "", `${change.status} ${change.path}`));
        rail.append(
          element(
            "p",
            "",
            `수집된 코드 변경 ${data.changes.files.length}개입니다.`,
          ),
        );
      }
    } catch (error) {
      status.textContent = "코드 근거 정보를 확인할 수 없습니다.";
      status.dataset.state = "missing";
      rail.replaceChildren(
        element(
          "h2",
          "",
          reading ? "코드 근거와 검토 기록" : "SOURCE EVIDENCE",
        ),
        element(
          "p",
          "",
          "근거 정보를 불러오지 못했습니다. 본문의 출처와 검토 기록을 확인하세요.",
        ),
      );
      console.warn("Document evidence unavailable:", error.message);
    }
  }
}
