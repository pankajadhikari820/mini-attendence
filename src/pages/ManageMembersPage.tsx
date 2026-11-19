import React from 'react';
import { PeopleManagerView } from '../components/PeopleManagerView';

interface ManageMembersPageProps {
  adminView?: boolean;
}

export const ManageMembersPage: React.FC<ManageMembersPageProps> = ({ adminView = false }) => {
  return <PeopleManagerView targetRole="member" adminViewingAllMembers={adminView} />;
};
