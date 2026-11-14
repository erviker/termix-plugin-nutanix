The Nutanix plugin connects Termix to Nutanix Prism Central (and optionally Prism Element) so you can inspect cluster capacity, AHV hosts, storage containers, and virtual machines in one place.

## Turn it on

1. Install the Nutanix plugin from Plugins.
2. Open Settings, Plugins, Nutanix and enter your Prism Central URL (for example `https://prism.example.com:9440`), username, and password.
3. Optionally enter your Prism Element cluster URL to include storage containers and hypervisor CPU/memory usage percentages.
4. Enable **Allow self-signed TLS certificates** only if your Prism appliance does not present a trusted CA certificate.

## Use it

- Open the **Nutanix** tab from the sidebar to browse Virtual Machines, AHV Hosts, Storage Containers, and Clusters.
- VMs whose primary or secondary NIC IPs (or VM name) match an existing Termix host show an **Open Terminal** shortcut directly in the VM table.
- Users with the **Manage Nutanix VMs** permission (`nutanix.manage`) can power VMs ON or OFF and import unlinked VMs into Termix under the configured folder (default `Nutanix VMs`).
- The plugin also registers `nutanix.summary`, `nutanix.list-vms`, and `nutanix.power-vm` actions in Termix Operations Center.
