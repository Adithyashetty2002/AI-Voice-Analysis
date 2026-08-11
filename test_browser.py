from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))
        page.goto("http://127.0.0.1:8000")
        # Give it a second to run JS
        page.wait_for_timeout(2000)
        # Try to click the bulk button
        try:
            page.click("#btnExportSessionPDF")
            print("Clicked btnExportSessionPDF successfully.")
        except Exception as e:
            print(f"Failed to click btnReevaluateSession: {e}")
        page.wait_for_timeout(1000)
        browser.close()

run()
