import { attachPopup, createPopup, detachPopup, Popup } from './popups_desktop';
import { PopupMode, Preferences } from './prefs';
import { Mutex, wait } from './utils';
import { ATTACH_DELAY_MS, DETACH_DELAY_MS, GREEN_ANCHOR_SELECTOR, PTR_SHORT_SIDE_LENGTH_PX } from './consts';

let activePopup: Popup | null;

// Below 3 must be valid at the same time
let activeAnchor: HTMLAnchorElement | null;
let cursorPageX: number | null;
let cursorPageY: number | null;

const mutex = new Mutex();
let attachmentAC = new AbortController();
let detachmentAC = new AbortController();

async function attachActivePopup() {
  // Guard section -- this need to also be executed immediately
  // So place both in and out of critical part
  if (activePopup) {
    if (!activeAnchor || activePopup.anchor === activeAnchor) {
      // `activeAnchor` is null: invalid state, should be detached first, do nothing
      // or `activeAnchor` has popup on, also a no-op
      return;
    } else {
      await detachActivePopupImmediately();
    }
  }

  const release = await mutex.acquire();
  try {
    if (activePopup) {
      if (!activeAnchor || activePopup.anchor === activeAnchor) {
        // `activeAnchor` is null: invalid state, should be detached first, do nothing
        // or `activeAnchor` has popup on, also a no-op
        return;
      } else {
        await detachActivePopupImmediately();
      }
    }

    if (!activeAnchor || !cursorPageX || !cursorPageY) {
      return;
    }

    activePopup = createPopup(activeAnchor, cursorPageX, cursorPageY);
    if (!activePopup) {
      return;
    }
    await wait(ATTACH_DELAY_MS, attachmentAC.signal);
    attachPopup(activePopup);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // Attachment process cancelled, revert process
      await detachActivePopupImmediately();
    }

  } finally {
    release();
  }
}

function cancelAttachment() {
  attachmentAC.abort();
  attachmentAC = new AbortController();
}

async function detachActivePopupImmediately() {
  if (activePopup && activePopup.anchor !== activeAnchor) {
    const currentActivePopup = activePopup;
    activePopup = null;
    await detachPopup(currentActivePopup);
  }
}

async function detachActivePopup() {
  const release = await mutex.acquire();
  try {
    if (activePopup && activePopup.anchor !== activeAnchor) {
      await wait(DETACH_DELAY_MS, detachmentAC.signal);
      await detachActivePopupImmediately();
    }
  } catch {
    // No-op
  } finally {
    release();
  }
}

function cancelDetachment() {
  detachmentAC.abort();
  detachmentAC = new AbortController();
}

function run(prefs: Preferences) {
  document.body.addEventListener('mouseover', (ev) => {
    if (prefs.popup === PopupMode.OnHover && ev.target instanceof HTMLElement) {
      activeAnchor = ev.target.closest(GREEN_ANCHOR_SELECTOR);

      if (activeAnchor) {
        // Moving on an <a>
        cursorPageX = ev.pageX;
        cursorPageY = ev.pageY;
        cancelDetachment();
        void attachActivePopup();
      } else if (!activeAnchor && activePopup && !activePopup.elem.contains(ev.target)) {
        // Moving out of <a> and popup
        cancelAttachment();
        void detachActivePopup();
      } else {
        // Moving out of <a> but to popup; or
        // Moving out of <a> and no popup
        cancelDetachment();
      }
    }
  });

  document.body.addEventListener(
    'click',
    (ev) => {
      if (prefs.popup === PopupMode.OnClick && ev.target instanceof HTMLElement) {
        const oldAnchor = activeAnchor;
        activeAnchor = ev.target.closest(GREEN_ANCHOR_SELECTOR);

        if (activeAnchor) {
          cursorPageX = ev.pageX;
          cursorPageY = ev.pageY;
          if (!activePopup || oldAnchor !== activeAnchor) {
            // No popup for active <a>, should prevent navigation
            ev.stopImmediatePropagation();
            ev.preventDefault();
          }
          cancelDetachment();
          void attachActivePopup();
        } else if (!activePopup?.elem.contains(ev.target)) {
          // Clicked something else outside of popup and <a>
          if (activePopup) {
            ev.stopImmediatePropagation();
            ev.preventDefault();
          }
          cancelAttachment();
          void detachActivePopup();
        }
      }
    },
    true, // Add at capture phase to "mock an overlay"
  );

  document.body.addEventListener('focusin', (ev) => {
    // Only handle this in hover mode, otherwise it causes conflicts
    if (prefs.popup === PopupMode.OnHover && ev.target instanceof HTMLElement) {
      activeAnchor = ev.target.closest(GREEN_ANCHOR_SELECTOR);

      if (activeAnchor) {
        // Assume align with <a> vertically
        const rect = activeAnchor.getBoundingClientRect();
        cursorPageX = rect.left + PTR_SHORT_SIDE_LENGTH_PX;
        cursorPageY = rect.top;
        cancelDetachment();
        void attachActivePopup();
      } else if (!activePopup?.elem.contains(ev.target)) {
        cancelAttachment();
        void detachActivePopup();
      }
    }
  });
}

export default run;
