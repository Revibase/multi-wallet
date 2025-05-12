export function createAuthIframe(options: {
  authUrl: string;
  onClose: () => void;
}): Window | null {
  const { authUrl, onClose } = options;
  const isMobile = window.innerWidth <= 600 && window.innerHeight < 1024;

  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let modal: HTMLDivElement;

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    isDragging = true;
    startY = currentY = e.touches[0].clientY;
    modal.style.transition = "";
  }

  function onTouchMove(e: TouchEvent) {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      e.preventDefault();
      modal.style.transform = `translateY(${deltaY}px)`;
    }
  }

  function onTouchEnd() {
    if (!isDragging) return;
    isDragging = false;
    const deltaY = currentY - startY;
    modal.style.transition = "transform 0.3s ease";
    if (deltaY > 150) {
      modal.style.transform = `translateY(100%)`;
      setTimeout(onClose, 300);
    } else {
      modal.style.transform = "translateY(0)";
    }
  }

  document.body.style.overflow = "hidden";
  // Create or reuse container
  let container = document.getElementById(
    "revibase-auth-modal-container"
  ) as HTMLDivElement;
  if (!container) {
    container = document.createElement("div");
    container.id = "revibase-auth-modal-container";
    container.addEventListener("click", (e) => {
      if (e.target === container) onClose();
    });
    document.body.appendChild(container);
  }

  Object.assign(container.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100dvh",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center",
    zIndex: "9999",
  });

  modal = document.getElementById("revibase-auth-modal") as HTMLDivElement;
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "revibase-auth-modal";
    container.appendChild(modal);
  }

  modal.innerHTML = ""; // clear previous content

  Object.assign(modal.style, {
    position: "relative",
    width: "100%",
    maxWidth: "500px",
    backgroundColor: "#fff",
    borderRadius: isMobile ? "16px 16px 0 0" : "16px",
    boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
    overflow: "hidden",
    transition: "transform 0.3s ease",
    transform: isMobile ? "translateY(100%)" : "none",
    touchAction: "manipulation",
  });

  // Spinner
  const spinner = document.createElement("div");
  spinner.id = "auth-loading-spinner";
  Object.assign(spinner.style, {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "40px",
    height: "40px",
    marginLeft: "-20px",
    marginTop: "-20px",
    border: "4px solid #ccc",
    borderTop: "4px solid #3b82f6",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    zIndex: "10000",
  });

  const style = document.createElement("style");
  style.innerHTML = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  modal.appendChild(spinner);

  // Drag handle for mobile
  if (isMobile) {
    const dragHandle = document.createElement("div");
    Object.assign(dragHandle.style, {
      height: "40px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      touchAction: "none",
      cursor: "grab",
      position: "absolute",
      top: "0",
      width: "100%",
      zIndex: "10001",
    });

    const dragIndicator = document.createElement("div");
    Object.assign(dragIndicator.style, {
      width: "40px",
      height: "6px",
      backgroundColor: "#ccc",
      borderRadius: "3px",
    });

    dragHandle.appendChild(dragIndicator);
    modal.appendChild(dragHandle);

    dragHandle.addEventListener("touchstart", onTouchStart, { passive: false });
    dragHandle.addEventListener("touchmove", onTouchMove, { passive: false });
    dragHandle.addEventListener("touchend", onTouchEnd);
  } else {
    const closeButton = document.createElement("button");
    closeButton.innerHTML = "✕";
    Object.assign(closeButton.style, {
      position: "absolute",
      top: "12px",
      right: "12px",
      width: "32px",
      height: "32px",
      background: "#eee",
      border: "none",
      borderRadius: "50%",
      cursor: "pointer",
      fontSize: "16px",
      lineHeight: "32px",
      textAlign: "center",
    });
    closeButton.addEventListener("click", onClose);
    modal.appendChild(closeButton);
  }

  const iframe = document.createElement("iframe");
  iframe.src = authUrl;
  iframe.title = "Authentication";
  iframe.allow = "publickey-credentials-get; publickey-credentials-create";

  Object.assign(iframe.style, {
    width: "100%",
    height: isMobile ? `90dvh` : "600px",
    border: "none",
    display: "block",
  });

  iframe.addEventListener("load", () => {
    spinner.remove();
  });

  modal.appendChild(iframe);

  if (isMobile) {
    void modal.offsetHeight;
    setTimeout(() => {
      modal.style.transition = "transform 0.3s ease";
      modal.style.transform = "translate3d(0, 0, 0)";
    }, 10);
  }

  return iframe.contentWindow;
}

/**
 * Closes the auth modal with animation
 */
export function closeAuthModal() {
  const container = document.getElementById("revibase-auth-modal-container");
  if (!container) return;

  const modal = document.getElementById("revibase-auth-modal");
  const isMobile = window.innerWidth <= 600 && window.innerHeight < 1024;

  if (modal && isMobile) {
    modal.style.transition = "transform 0.3s ease";
    modal.style.transform = "translate3d(0, 100%, 0)";

    setTimeout(() => {
      document.body.style.overflow = "";
      container.style.display = "none";
    }, 300);
  } else {
    document.body.style.overflow = "";
    container.style.display = "none";
  }
}
