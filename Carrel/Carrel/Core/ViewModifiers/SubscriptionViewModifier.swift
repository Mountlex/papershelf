import SwiftUI

/// View modifier that manages subscription lifecycle for a SubscribableViewModel.
///
/// Starts the subscription when the view appears. Subscriptions run persistently rather than
/// stopping on disappear, since SwiftUI's onDisappear fires spuriously during view restructuring
/// even when the view is still logically visible.
struct SubscriptionLifecycleModifier<VM: SubscribableViewModel>: ViewModifier {
    let viewModel: VM

    func body(content: Content) -> some View {
        content
            .task {
                viewModel.startSubscription()
            }
    }
}

extension View {
    /// Manages subscription lifecycle for a SubscribableViewModel.
    ///
    /// Starts the subscription when the view appears. Subscriptions run persistently
    /// until the ViewModel is deallocated (e.g., when the user logs out).
    ///
    /// Usage:
    /// ```swift
    /// MyView()
    ///     .manageSubscription(viewModel)
    /// ```
    func manageSubscription<VM: SubscribableViewModel>(_ viewModel: VM) -> some View {
        modifier(SubscriptionLifecycleModifier(viewModel: viewModel))
    }
}
