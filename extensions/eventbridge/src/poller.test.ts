import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSqsPoller, deleteMessage } from "./poller.js";

// Minimal mock SQS client: intercepts `send` calls.
function createMockSqsClient() {
  const sendMock = vi.fn();
  const client = { send: sendMock } as any;
  return { client, sendMock };
}

function createAbortController() {
  const controller = new AbortController();
  return controller;
}

describe("poller", () => {
  describe("runSqsPoller", () => {
    it("stops when abortSignal is already aborted", async () => {
      const { client, sendMock } = createMockSqsClient();
      const controller = createAbortController();
      controller.abort();

      await runSqsPoller({
        client,
        config: {
          queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q",
          maxMessages: 10,
          waitTimeSeconds: 20,
        },
        callbacks: { onMessages: vi.fn(), onError: vi.fn() },
        abortSignal: controller.signal,
      });

      expect(sendMock).not.toHaveBeenCalled();
    });

    it("calls onMessages with parsed SQS messages", async () => {
      const { client, sendMock } = createMockSqsClient();
      const controller = createAbortController();
      const onMessages = vi.fn().mockResolvedValue(undefined);
      const statusSink = vi.fn();

      // First call returns messages, then abort.
      sendMock.mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve({
          Messages: [
            {
              MessageId: "msg-1",
              ReceiptHandle: "rh-1",
              Body: JSON.stringify({
                source: "test",
                detailType: "Evt",
                correlationId: "abc",
                payload: {},
              }),
              Attributes: { ApproximateReceiveCount: "2" },
            },
          ],
        });
      });

      await runSqsPoller({
        client,
        config: {
          queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q",
          maxMessages: 5,
          waitTimeSeconds: 10,
        },
        callbacks: { onMessages, onError: vi.fn(), statusSink },
        abortSignal: controller.signal,
      });

      expect(onMessages).toHaveBeenCalledWith([
        {
          messageId: "msg-1",
          receiptHandle: "rh-1",
          body: { source: "test", detailType: "Evt", correlationId: "abc", payload: {} },
          approximateReceiveCount: 2,
        },
      ]);
      expect(statusSink).toHaveBeenCalledWith({ lastInboundAt: expect.any(Number) });
    });

    it("calls onError and applies backoff on transient error", async () => {
      const { client, sendMock } = createMockSqsClient();
      const controller = createAbortController();
      const onError = vi.fn();

      let callCount = 0;
      sendMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("network timeout"));
        }
        // After backoff sleep, abort to end the loop.
        controller.abort();
        return Promise.resolve({ Messages: [] });
      });

      await runSqsPoller({
        client,
        config: {
          queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q",
          maxMessages: 10,
          waitTimeSeconds: 20,
        },
        callbacks: { onMessages: vi.fn().mockResolvedValue(undefined), onError },
        abortSignal: controller.signal,
      });

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it("passes configured MaxNumberOfMessages and WaitTimeSeconds to ReceiveMessageCommand", async () => {
      const { client, sendMock } = createMockSqsClient();
      const controller = createAbortController();

      sendMock.mockImplementationOnce((_cmd: any) => {
        controller.abort();
        return Promise.resolve({ Messages: [] });
      });

      await runSqsPoller({
        client,
        config: {
          queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q",
          maxMessages: 7,
          waitTimeSeconds: 15,
        },
        callbacks: { onMessages: vi.fn().mockResolvedValue(undefined), onError: vi.fn() },
        abortSignal: controller.signal,
      });

      const command = sendMock.mock.calls[0]![0];
      expect(command.input.MaxNumberOfMessages).toBe(7);
      expect(command.input.WaitTimeSeconds).toBe(15);
      expect(command.input.QueueUrl).toBe("https://sqs.us-east-1.amazonaws.com/123/q");
    });

    it("handles non-JSON message body by returning raw string", async () => {
      const { client, sendMock } = createMockSqsClient();
      const controller = createAbortController();
      const onMessages = vi.fn().mockResolvedValue(undefined);

      sendMock.mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve({
          Messages: [
            {
              MessageId: "msg-2",
              ReceiptHandle: "rh-2",
              Body: "not valid json",
              Attributes: { ApproximateReceiveCount: "1" },
            },
          ],
        });
      });

      await runSqsPoller({
        client,
        config: {
          queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q",
          maxMessages: 10,
          waitTimeSeconds: 20,
        },
        callbacks: { onMessages, onError: vi.fn() },
        abortSignal: controller.signal,
      });

      expect(onMessages).toHaveBeenCalledWith([
        expect.objectContaining({ body: "not valid json" }),
      ]);
    });

    it("does not call statusSink when no messages are received", async () => {
      const { client, sendMock } = createMockSqsClient();
      const controller = createAbortController();
      const statusSink = vi.fn();

      sendMock.mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve({ Messages: [] });
      });

      await runSqsPoller({
        client,
        config: {
          queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q",
          maxMessages: 10,
          waitTimeSeconds: 20,
        },
        callbacks: {
          onMessages: vi.fn().mockResolvedValue(undefined),
          onError: vi.fn(),
          statusSink,
        },
        abortSignal: controller.signal,
      });

      expect(statusSink).not.toHaveBeenCalled();
    });
  });

  describe("deleteMessage", () => {
    it("sends DeleteMessageCommand with correct queue URL and receipt handle", async () => {
      const { client, sendMock } = createMockSqsClient();
      sendMock.mockResolvedValue({});

      await deleteMessage({
        client,
        queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q",
        receiptHandle: "rh-abc-123",
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const command = sendMock.mock.calls[0]![0];
      expect(command.input.QueueUrl).toBe("https://sqs.us-east-1.amazonaws.com/123/q");
      expect(command.input.ReceiptHandle).toBe("rh-abc-123");
    });
  });
});
