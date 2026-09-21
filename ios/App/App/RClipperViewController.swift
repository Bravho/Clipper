import Capacitor

class RClipperViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(DeviceVideoRenderPlugin())
    }
}
