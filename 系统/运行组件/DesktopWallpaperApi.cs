using System;
using System.Runtime.InteropServices;

namespace AA
{
    public static class DesktopWallpaper
    {
        [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IDesktopWallpaper
        {
            void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
            void GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] out string wallpaper);
            void GetMonitorDevicePathAt(uint monitorIndex, [MarshalAs(UnmanagedType.LPWStr)] out string monitorID);
            void GetMonitorDevicePathCount(out uint count);
            void GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID, out RECT rect);
            void SetBackgroundColor(uint color);
            void GetBackgroundColor(out uint color);
            void SetPosition(int position);
            void GetPosition(out int position);
            void SetSlideshow(IShellItemArray items);
            void GetSlideshow(out IShellItemArray items);
            void SetSlideshowOptions(int options, uint slideshowTick);
            void GetSlideshowOptions(out int options, out uint slideshowTick);
            void AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string monitorID, int direction);
            void GetStatus(out int state);
            void Enable(int enable);
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellItem
        {
            void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            void GetParent(out IShellItem ppsi);
            void GetDisplayName(uint sigdnName, out IntPtr ppszName);
            void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
            void Compare(IShellItem psi, uint hint, out int piOrder);
        }

        [ComImport, Guid("B63EA76D-1F85-456F-A19C-48159EFA858B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellItemArray
        {
            void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
            void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
            void GetAttributes(int attribFlags, uint sfgaoMask, out uint psfgaoAttribs);
            void GetCount(out uint count);
            void GetItemAt(uint index, out IShellItem item);
            void EnumItems(out IntPtr enumItems);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        private static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

        [DllImport("shell32.dll", PreserveSig = false)]
        private static extern void SHCreateShellItemArrayFromShellItem(IShellItem item, ref Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IShellItemArray array);

        private static IDesktopWallpaper Create()
        {
            var type = Type.GetTypeFromCLSID(new Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD"));
            return (IDesktopWallpaper)Activator.CreateInstance(type);
        }

        /// <summary>把桌面壁纸设为指定文件夹的幻灯片，返回状态摘要。</summary>
        public static string SetSlideshow(string folder, bool shuffle, int intervalMs)
        {
            var dw = Create();
            try
            {
                Guid iidItem = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                Guid iidArray = new Guid("B63EA76D-1F85-456F-A19C-48159EFA858B");
                IShellItem item;
                SHCreateItemFromParsingName(folder, IntPtr.Zero, ref iidItem, out item);
                IShellItemArray arr;
                SHCreateShellItemArrayFromShellItem(item, ref iidArray, out arr);
                try
                {
                    dw.SetSlideshow(arr);
                    dw.SetSlideshowOptions(shuffle ? 1 : 0, (uint)intervalMs);
                    dw.Enable(1);
                    // 立刻切一张，否则桌面还停在上一次的静态图上（失败不影响主流程）
                    try
                    {
                        string monitorId;
                        dw.GetMonitorDevicePathAt(0, out monitorId);
                        dw.AdvanceSlideshow(monitorId, 0);
                    }
                    catch { }
                    int state, position, options;
                    uint tick;
                    dw.GetStatus(out state);
                    dw.GetPosition(out position);
                    dw.GetSlideshowOptions(out options, out tick);
                    return string.Format("status={0} position={1} options={2} tick={3}", state, position, options, tick);
                }
                finally
                {
                    Marshal.ReleaseComObject(arr);
                    Marshal.ReleaseComObject(item);
                }
            }
            finally
            {
                Marshal.ReleaseComObject(dw);
            }
        }

        /// <summary>前进到幻灯片下一张，用于确认幻灯片确实生效。</summary>
        public static void Advance()
        {
            var dw = Create();
            try { dw.AdvanceSlideshow(null, 0); }
            finally { Marshal.ReleaseComObject(dw); }
        }
    }
}
