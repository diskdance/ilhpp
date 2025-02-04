import {
  DT_PTR_SHORT_SIDE_LENGTH_PX,
  DT_PTR_WIDTH_PX,
  ROOT_CLASS_DESKTOP,
  DT_DETACH_ANIMATION_MS,
  DT_DETACH_DELAY_MS,
} from './consts';
import { getPagePreview } from './network';
import { createPopupBase, PopupBase } from './popups';
import { getPreferences, PopupMode } from './prefs';
import { getDirection, isWikipedia, wait } from './utils';

interface CursorParam {
  pageX: number;
  pageY: number;
}

interface LayoutParam {
  cursor?: CursorParam;
  popupRect: DOMRect;
  anchorBoundingRect: DOMRect;
  anchorRects: DOMRectList;
}

interface Layout {
  pageX: number;
  pageY: number;
  isRight: boolean;
  isBottom: boolean;
}

const enum State {
  Attached,
  Detached,
}

interface Popup extends PopupBase {
  state: State;

  elem: HTMLElement;
  anchor: HTMLAnchorElement;
  oldTooltip: string | null;

  cursor?: CursorParam;
  isCausedByTouch: boolean;
  abortController: AbortController;
  detachHandler: () => void;
  cancelDetachingHandler: () => void;
}

/**
 * Get real bounding rectangle with CSS applied.
 * @param elem
 * @returns
 */
function getRealRect(elem: HTMLElement): DOMRect {
  const sandbox = document.createElement('div');
  sandbox.style.position = 'absolute';
  sandbox.style.visibility = 'hidden';
  sandbox.style.width = '0px';
  sandbox.style.height = '0px';
  sandbox.appendChild(elem);
  document.body.appendChild(sandbox);

  const result = elem.getBoundingClientRect();

  elem.remove();
  sandbox.remove();

  return result;
}

/**
 * Get the layout of the popup based on its location and size.
 * @param layoutParam
 * @returns
 */
function getLayout(layoutParam: LayoutParam): Layout {
  const pageScrollOffsetX = window.scrollX;
  const pageScrollOffsetY = window.scrollY;
  const viewpointWidth = document.documentElement.clientWidth;
  const viewpointHeight = document.documentElement.clientHeight;

  const width = layoutParam.popupRect.width;
  const height = layoutParam.popupRect.height;

  // Falls back to this value to align with left boundary
  const cursorPageX =
    layoutParam.cursor?.pageX ?? layoutParam.anchorBoundingRect.left + DT_PTR_SHORT_SIDE_LENGTH_PX;

  // Get the rect of the correct line the cursor is right in
  // by determining which line's mid point the cursor is closest to
  // This will happen if the <a> is line wrapped
  const currentAnchorLineRect = layoutParam.cursor
    ? [...layoutParam.anchorRects]
        .map(
          (rect) =>
            [
              rect,
              Math.abs(
                pageScrollOffsetY + (rect.top + rect.bottom) / 2 - layoutParam.cursor!.pageY,
              ),
            ] as const,
        )
        .reduce((prev, curr) => (curr[1] < prev[1] ? curr : prev))[0]
    : layoutParam.anchorBoundingRect; // Falls back to full bounding rect

  const anchorPageTop = currentAnchorLineRect.top + pageScrollOffsetY;
  const anchorPageBottom = currentAnchorLineRect.bottom + pageScrollOffsetY;

  // X: Right if cursor at left half, left if at right half
  const isRight = cursorPageX < pageScrollOffsetX + viewpointWidth / 2;
  const pageX = isRight
    ? cursorPageX - DT_PTR_SHORT_SIDE_LENGTH_PX
    : cursorPageX - width + DT_PTR_SHORT_SIDE_LENGTH_PX;

  // Y: Bottom if anchor at top half, top if at bottom half
  // This should always align with the current line, so use the anchor's coordinate
  const isBottom = anchorPageTop < pageScrollOffsetY + viewpointHeight / 2;
  const pageY = isBottom
    ? anchorPageBottom + DT_PTR_WIDTH_PX
    : anchorPageTop - height - DT_PTR_WIDTH_PX;

  return { pageX, pageY, isRight, isBottom };
}

function buildPopup(popup: Popup) {
  const root = popup.elem;
  root.className = `${ROOT_CLASS_DESKTOP} ${ROOT_CLASS_DESKTOP}--foreign-${getDirection(popup.langCode)} ${ROOT_CLASS_DESKTOP}--loading`;

  const header = document.createElement('a');
  header.href = popup.foreignHref;
  header.className = `${ROOT_CLASS_DESKTOP}__header ilhpp-text-like ilhpp-auto-hyphen`;
  header.lang = popup.langCode;
  header.dir = 'auto';
  header.innerText = popup.foreignTitle;

  const subheader = document.createElement('div');
  subheader.className = `${ROOT_CLASS_DESKTOP}__subheader`;
  subheader.dir = 'auto';
  subheader.innerText = mw.msg(
    'ilhpp-from',
    popup.langName,
    isWikipedia(popup.wikiCode) ? mw.msg('ilhpp-wp') : '',
  );

  const main = document.createElement('div');
  main.className = `${ROOT_CLASS_DESKTOP}__main ${ROOT_CLASS_DESKTOP}__main--loading`;

  const extract = document.createElement('a');
  extract.href = popup.foreignHref;
  extract.lang = popup.langCode;
  extract.className = `${ROOT_CLASS_DESKTOP}__main__extract ilhpp-text-like ilhpp-auto-hyphen`;
  extract.dir = 'auto';

  const more = document.createElement('a');
  more.href = popup.foreignHref;
  more.className = `${ROOT_CLASS_DESKTOP}__main__more`;
  more.innerText = mw.msg('ilhpp-more');

  main.append(extract, more);

  const cta = document.createElement('div');
  cta.className = `${ROOT_CLASS_DESKTOP}__cta`;

  const ctaInner = document.createElement('div');
  ctaInner.className = `${ROOT_CLASS_DESKTOP}__cta__inner`;
  ctaInner.innerHTML = mw.msg('ilhpp-cta', popup.origTitle); // Safely escaped

  const settingsButton = document.createElement('button');
  settingsButton.className = `${cta.className}__settings`;
  settingsButton.ariaLabel = settingsButton.title = mw.msg('ilhpp-settings');
  settingsButton.addEventListener('click', () => {
    void (async () => {
      settingsButton.disabled = true;
      const { showSettingsDialog } = await import('ext.gadget.ilhpp-settings');
      await detachPopup(popup);
      showSettingsDialog();
    })();
  });

  cta.append(ctaInner, settingsButton);
  root.append(header, subheader, main, cta);

  const rect = getRealRect(root);
  const layout = getLayout({
    popupRect: rect,
    anchorBoundingRect: popup.anchor.getBoundingClientRect(),
    anchorRects: popup.anchor.getClientRects(),
    cursor: popup.cursor,
  });
  root.style.top = `${layout.pageY}px`;
  root.style.left = `${layout.pageX}px`;

  root.classList.add(`${ROOT_CLASS_DESKTOP}--${layout.isBottom ? 'bottom' : 'top'}`);
  root.classList.add(`${ROOT_CLASS_DESKTOP}--${layout.isRight ? 'right' : 'left'}`);

  if (!layout.isBottom) {
    // Need to change `top` accordingly when size is changed

    // Support Safari < 13.1: ResizeObserver is not available
    // FIXME: Migrate to that after we raise browser target
    const observer = new MutationObserver(() => {
      // Guaranteed to have only one entry
      const newTop = layout.pageY + rect.height - root.clientHeight;
      root.style.top = `${newTop}px`;
    });
    observer.observe(popup.elem, { subtree: true, childList: true });
  }

  root.addEventListener('mouseleave', popup.detachHandler);
  popup.anchor.addEventListener('mouseleave', popup.detachHandler);

  root.addEventListener('mouseenter', popup.cancelDetachingHandler);
  popup.anchor.addEventListener('mouseenter', popup.cancelDetachingHandler);

  void getPagePreview(popup.wikiCode, popup.foreignTitle, popup.abortController.signal).then(
    (preview) => {
      root.classList.remove(`${ROOT_CLASS_DESKTOP}--loading`);
      header.innerText = preview.title;

      if (preview.isDisambiguation) {
        root.classList.add(`${ROOT_CLASS_DESKTOP}--disam`);
        extract.removeAttribute('lang'); // This is Chinese now

        extract.innerText = mw.msg('ilhpp-disam');
        more.innerText = mw.msg('ilhpp-disam-more');
      } else {
        root.classList.add(`${ROOT_CLASS_DESKTOP}--standard`);

        extract.innerHTML = preview.mainHtml; // Trust gateway's result as safely escaped
      }
    },
    (err) => {
      switch ((err as Error)?.name) {
        case 'AbortError':
          // Exclude AbortError to prevent glitches
          break;

        case 'NotSupportedError':
          root.classList.remove(`${ROOT_CLASS_DESKTOP}--loading`);
          root.classList.add(`${ROOT_CLASS_DESKTOP}--no-preview`);
          extract.removeAttribute('lang'); // This is Chinese now

          extract.innerText = mw.msg('ilhpp-no-preview');
          more.innerText = mw.msg('ilhpp-goto');
          break;

        case 'NotFoundError':
          root.classList.remove(`${ROOT_CLASS_DESKTOP}--loading`);
          root.classList.add(`${ROOT_CLASS_DESKTOP}--error`);
          extract.removeAttribute('lang'); // This is Chinese now

          // messages.json is trusted
          extract.innerHTML = mw.msg(
            'ilhpp-error-not-found',
            encodeURIComponent(mw.config.get('wgPageName')),
          );
          more.innerText = mw.msg('ilhpp-goto');
          break;

        default:
          root.classList.remove(`${ROOT_CLASS_DESKTOP}--loading`);
          root.classList.add(`${ROOT_CLASS_DESKTOP}--error`);
          extract.removeAttribute('lang'); // This is Chinese now

          extract.innerText = mw.msg('ilhpp-error');
          more.innerText = mw.msg('ilhpp-goto');
          break;
      }
    },
  );
}

/**
 *
 * @param anchor
 * @param isCausedByTouch `true` will prevent popup itself's detaching event from working
 * @param oldTooltip <a>'s old tooltip if removed first, if `null` this function will do the removal
 * @param cursor `undefined` if attaching is not caused by pointing devices (e.g. keyboard focus)
 * @returns
 */
function attachPopup(
  anchor: HTMLAnchorElement,
  isCausedByTouch: boolean,
  oldTooltip: string | null,
  cursor?: CursorParam,
): Popup | null {
  const popupBase = createPopupBase(anchor);
  if (!popupBase) {
    return null;
  }

  let timeoutId: ReturnType<typeof setTimeout>;

  const popup: Popup = {
    ...popupBase,
    state: State.Attached,
    elem: document.createElement('div'),
    anchor,
    oldTooltip,
    cursor,
    isCausedByTouch,
    abortController: new AbortController(),
    detachHandler() {
      if (!isCausedByTouch && getPreferences().popup === PopupMode.OnHover) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          void detachPopup(popup);
        }, DT_DETACH_DELAY_MS);
      }
    },
    cancelDetachingHandler() {
      if (!isCausedByTouch && getPreferences().popup === PopupMode.OnHover) {
        clearTimeout(timeoutId);
      }
    },
  };

  buildPopup(popup);
  document.body.appendChild(popup.elem);

  return popup;
}

async function detachPopup(popup: Popup) {
  if (popup.state === State.Detached) {
    return;
  }

  popup.state = State.Detached;
  popup.abortController.abort();
  popup.elem.classList.add(`${ROOT_CLASS_DESKTOP}--out`);

  if (popup.oldTooltip !== null) {
    popup.anchor.title = popup.oldTooltip;
  }

  await wait(DT_DETACH_ANIMATION_MS);

  popup.anchor.removeEventListener('mouseleave', popup.detachHandler);
  popup.anchor.removeEventListener('mouseenter', popup.cancelDetachingHandler);

  popup.elem.remove();
}

export { type Popup, type CursorParam, State, attachPopup, detachPopup };
