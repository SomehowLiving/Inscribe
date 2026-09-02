/**
 * A real, LLM-driven agent. Unlike demo-agent.js (a fixed script), this one
 * decides its own actions: it sends the live forge.* tool schemas and the
 * running conversation to /api/agent, gets back either a tool call or a
 * final answer, and — for tool calls — actually executes them against the
 * real VFS/UI via webmcp.callTool(), then reports the result back to the
 * model and repeats.
 */
class RealAgent {
  constructor(app) {
    this.app = app;
    this.running = false;
    this.messages = [];
  }

  // POST /api/agent with retry on transient failures (network errors, 5xx,
  // upstream model/provider errors). Does NOT retry 4xx (bad_request,
  // not_configured) — those won't be fixed by trying again.
  async callAgentStep(attempt = 1) {
    const MAX_ATTEMPTS = 3;
    let resp;
    let data;
    try {
      resp = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.messages,
          tools: this.app.webmcp.getToolSchemas(),
          model: this.model,
        }),
      });
      data = await resp.json();
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        this.app.appendTerminal(`[agent] network error (${err.message}) — retrying (${attempt}/${MAX_ATTEMPTS})...`);
        await this.delay(800 * attempt);
        return this.callAgentStep(attempt + 1);
      }
      return { ok: false, status: 0, data: { error: 'network_error', message: err.message } };
    }

    if (!resp.ok) {
      const retryable = resp.status >= 500 && resp.status !== 501;
      if (retryable && attempt < MAX_ATTEMPTS) {
        this.app.appendTerminal(
          `[agent] ${data.error || resp.status} (${data.message || 'transient failure'}) — retrying (${attempt}/${MAX_ATTEMPTS})...`
        );
        await this.delay(800 * attempt);
        return this.callAgentStep(attempt + 1);
      }
      return { ok: false, status: resp.status, data };
    }

    return { ok: true, status: resp.status, data };
  }

  delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async start(goal, model) {
    if (this.running) return;
    this.running = true;
    this.model = model;
    this.messages = [{ role: 'user', content: goal }];
    this.app.showChatMessage(goal, 'info');
    this.app.setAgentBusy(true);

    const MAX_STEPS = 15;
    let step = 0;

    try {
      while (this.running && step < MAX_STEPS) {
        step++;
        this.app.appendTerminal(`[agent] thinking (step ${step}/${MAX_STEPS})...`);

        const result = await this.callAgentStep();

        if (!result.ok) {
          this.app.showChatMessage(
            `Agent error (${result.data.error || result.status}): ${result.data.message || 'unknown failure'}`,
            'error'
          );
          break;
        }

        const data = result.data;
        this.messages.push(...data.responseMessages);

        if (!data.toolCalls || data.toolCalls.length === 0) {
          if (data.text) this.app.showChatMessage(data.text, 'success');
          break;
        }

        const resultParts = [];
        for (const call of data.toolCalls) {
          this.app.appendTerminal(`[agent] ${call.toolName}(${JSON.stringify(call.input)})`);
          try {
            const toolResult = await this.app.webmcp.callTool(call.toolName, call.input);
            resultParts.push({
              type: 'tool-result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: { type: 'json', value: toolResult === undefined ? null : toolResult },
            });
          } catch (err) {
            resultParts.push({
              type: 'tool-result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: { type: 'error-json', value: { message: err.message } },
            });
          }
          if (call.toolName.startsWith('forge.file.')) {
            this.app.renderFileTree();
          }
        }
        this.messages.push({ role: 'tool', content: resultParts });

        if (step >= MAX_STEPS) {
          this.app.showChatMessage('Agent stopped: reached the step limit for this run.', 'warning');
        }
      }
    } catch (err) {
      this.app.showChatMessage(`Agent failed: ${err.message}`, 'error');
    } finally {
      this.running = false;
      this.app.setAgentBusy(false);
    }
  }

  stop() {
    this.running = false;
  }
}

window.RealAgent = RealAgent;
