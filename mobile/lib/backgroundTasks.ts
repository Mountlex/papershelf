import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import { getPendingDownloadsCount } from "./offlineStorage";

const BACKGROUND_DOWNLOAD_TASK = "background-pdf-download";

/**
 * Define the background task
 * This runs periodically when the app is in the background
 */
TaskManager.defineTask(BACKGROUND_DOWNLOAD_TASK, async () => {
  try {
    // Check if there are pending downloads
    const pendingCount = await getPendingDownloadsCount();

    if (pendingCount > 0) {
      // Note: We can't directly access the download manager here
      // because background tasks run in a separate JS context.
      // Instead, we signal that there's work to do, and the app
      // will resume downloads when it returns to foreground.

      // In a more advanced implementation, you could:
      // 1. Use expo-notifications to notify user of pending downloads
      // 2. Use a native module for true background downloads
      // 3. Store resume state and continue when app opens

      console.log(`Background task: ${pendingCount} downloads pending`);
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error("Background task error:", error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register background tasks
 */
export async function registerBackgroundTasks(): Promise<void> {
  try {
    // Check if already registered
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_DOWNLOAD_TASK
    );

    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_DOWNLOAD_TASK, {
        minimumInterval: 60 * 15, // 15 minutes minimum
        stopOnTerminate: false,
        startOnBoot: true,
      });

      console.log("Background download task registered");
    }
  } catch (error) {
    console.error("Failed to register background task:", error);
  }
}

/**
 * Unregister background tasks
 */
export async function unregisterBackgroundTasks(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_DOWNLOAD_TASK
    );

    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_DOWNLOAD_TASK);
      console.log("Background download task unregistered");
    }
  } catch (error) {
    console.error("Failed to unregister background task:", error);
  }
}

/**
 * Check background fetch status
 */
export async function getBackgroundFetchStatus(): Promise<BackgroundFetch.BackgroundFetchStatus> {
  return await BackgroundFetch.getStatusAsync();
}
