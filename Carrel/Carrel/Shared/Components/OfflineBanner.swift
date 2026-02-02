import SwiftUI

/// Banner displayed when the device is offline.
/// Shows at the top of the screen to notify users they have no network connection.
struct OfflineBanner: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .font(.subheadline)
            Text("No internet connection")
                .font(.subheadline)
                .fontWeight(.medium)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color.orange)
    }
}

#Preview {
    VStack(spacing: 0) {
        OfflineBanner()
        Spacer()
    }
}
