import axios from "axios";
import dotenv from "dotenv";
import {
    getProxyAgent, getRandomProxy, maskProxyUrl, proxyManager, reportProxyFailure, reportProxySuccess
} from "../lib/proxy-rotation";
import { syncProxies } from "../lib/proxy-settings";

dotenv.config();

async function testProxy() {
  // The proxies saved on admin Proxies.
  await syncProxies();
  const stats = proxyManager.getStats();
  console.log(
    `Initial Proxy Stats: Total: ${stats.total}, Available: ${stats.available}`,
  );

  if (stats.total === 0) {
    console.log("No proxies configured. Skipping test.");
    return;
  }

  // 1. Test success reporting
  console.log("\n--- Testing Success Reporting ---");
  const p1 = getRandomProxy();
  if (p1) {
    try {
      const agent = getProxyAgent(p1);
      await axios.get("https://api.ipify.org?format=json", {
        httpsAgent: agent,
        proxy: false,
        timeout: 5000,
      });
      reportProxySuccess(p1);
      console.log(`Proxy ${maskProxyUrl(p1)} reported success.`);
    } catch {
      reportProxyFailure(p1);
    }
  }

  // 2. Test failure reporting and sidelining
  console.log("\n--- Testing Failure Reporting (Sidelining) ---");
  const p2 = getRandomProxy();
  if (p2) {
    console.log(`Simulating 3 failures for proxy: ${maskProxyUrl(p2)}`);
    reportProxyFailure(p2);
    reportProxyFailure(p2);
    reportProxyFailure(p2);

    const newStats = proxyManager.getStats();
    console.log(
      `Updated Stats: Total: ${newStats.total}, Available: ${newStats.available}, Sidelined: ${newStats.sidelined}`,
    );
  }

  // 3. Verify rotation avoids sidelined proxy
  console.log("\n--- Verifying Rotation ---");
  for (let i = 0; i < 5; i++) {
    const p = getRandomProxy();
    console.log(`Selected for request ${i + 1}: ${p ? maskProxyUrl(p) : "none"}`);
  }
}

testProxy().catch(console.error);
