import Combine
import Foundation

/// Protocol for ViewModels that manage Convex subscriptions for real-time data updates.
///
/// Conforming types should implement `createSubscriptionPublisher()` to return their
/// specific Combine publisher and `handleSubscriptionData(_:)` to process received data.
@MainActor
protocol SubscribableViewModel: AnyObject {
    associatedtype SubscriptionData

    /// The current subscription task, if any
    var subscriptionTask: Task<Void, Never>? { get set }

    /// Timestamp of when the subscription was last stopped (for debouncing)
    var subscriptionStoppedAt: Date? { get set }

    /// Whether the view model is loading initial data
    var isLoading: Bool { get set }

    /// Current error message, if any
    var error: String? { get set }

    /// Optional async setup to run before creating the subscription publisher.
    /// Override this to fetch required data (e.g., user ID) before starting.
    /// Throw an error to abort subscription startup.
    func setupBeforeSubscription() async throws

    /// Creates the Combine publisher for this subscription
    func createSubscriptionPublisher() -> AnyPublisher<SubscriptionData, Error>

    /// Handles data received from the subscription
    func handleSubscriptionData(_ data: SubscriptionData)
}

extension SubscribableViewModel {
    /// Default implementation does nothing
    func setupBeforeSubscription() async throws {}

    /// Start subscribing to real-time updates
    func startSubscription() {
        // Don't restart if already subscribed
        guard subscriptionTask == nil else {
            #if DEBUG
            print("\(type(of: self)): Subscription already active, skipping")
            #endif
            return
        }

        // Debounce rapid restarts (within 0.5 seconds of stop)
        // This prevents spurious SwiftUI lifecycle events from causing duplicate subscriptions
        if let stoppedAt = subscriptionStoppedAt, Date().timeIntervalSince(stoppedAt) < 0.5 {
            #if DEBUG
            print("\(type(of: self)): Subscription restart too soon after stop, skipping")
            #endif
            return
        }

        subscriptionStoppedAt = nil
        isLoading = true

        subscriptionTask = Task {
            do {
                // Run async setup first (e.g., fetch user ID)
                try await setupBeforeSubscription()

                let publisher = createSubscriptionPublisher()

                for try await data in publisher.values {
                    guard !Task.isCancelled else { break }
                    await MainActor.run {
                        self.handleSubscriptionData(data)
                        if self.isLoading {
                            self.isLoading = false
                        }
                    }
                }
            } catch {
                if !Task.isCancelled {
                    await MainActor.run {
                        self.error = error.localizedDescription
                        self.isLoading = false
                    }
                }
            }
        }
    }

    /// Stop the current subscription
    func stopSubscription() {
        #if DEBUG
        print("\(type(of: self)): Stopping subscription")
        #endif
        subscriptionTask?.cancel()
        subscriptionTask = nil
        subscriptionStoppedAt = Date()
    }
}
