import { Route, Routes } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import AcceptInvite from '@/pages/AcceptInvite';
import Account from '@/pages/Account';
import ForgotPassword from '@/pages/ForgotPassword';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import Members from '@/pages/Members';
import OrgOverview from '@/pages/OrgOverview';
import Orgs from '@/pages/Orgs';
import ProjectDetail from '@/pages/ProjectDetail';
import Projects from '@/pages/Projects';
import Register from '@/pages/Register';
import ResetPassword from '@/pages/ResetPassword';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';
import ScanReport from '@/pages/ScanReport';
import ManualTasks from '@/pages/ManualTasks';
import FindingDetail from '@/pages/FindingDetail';
import QuickCheck from '@/pages/QuickCheck';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/quick-check" element={<QuickCheck />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Shell />}>
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/account" element={<Account />} />
        <Route path="/orgs" element={<Orgs />} />
        <Route path="/orgs/:orgId" element={<OrgOverview />} />
        <Route path="/orgs/:orgId/members" element={<Members />} />
        <Route path="/orgs/:orgId/settings" element={<Settings />} />
        <Route path="/orgs/:orgId/projects" element={<Projects />} />
        <Route path="/orgs/:orgId/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/orgs/:orgId/scans/:scanId" element={<ScanReport />} />
        <Route path="/orgs/:orgId/scans/:scanId/manual" element={<ManualTasks />} />
        <Route path="/orgs/:orgId/findings/:findingId" element={<FindingDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
